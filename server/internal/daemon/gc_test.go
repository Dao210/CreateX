package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/auro-ai/auro/server/internal/daemon/execenv"
	"github.com/auro-ai/auro/server/internal/daemon/repocache"
)

// newGCTestDaemon creates a minimal Daemon for GC testing with a mock HTTP server.
func newGCTestDaemon(t *testing.T, handler http.Handler) *Daemon {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	root := t.TempDir()
	cfg := Config{
		WorkspacesRoot:           root,
		GCEnabled:                true,
		GCInterval:               1 * time.Hour,
		GCTTL:                    5 * 24 * time.Hour,
		GCOrphanTTL:              30 * 24 * time.Hour,
		GCArtifactTTL:            12 * time.Hour,
		GCArtifactPatterns:       []string{"node_modules", ".next", ".turbo"},
		GCRepoMaintenanceEnabled: true,
	}
	d := New(cfg, slog.Default())
	d.client = NewClient(srv.URL)
	d.client.SetToken("test-token")
	return d
}

// createTaskDir creates a task directory with optional GC metadata.
func createTaskDir(t *testing.T, root, wsID, dirName string, meta *execenv.GCMeta) string {
	t.Helper()
	taskDir := filepath.Join(root, wsID, dirName)
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	// Production task directories end in the task key rather than the full
	// task ID. Keep human-readable fixture names while making the owner marker
	// obey the same path/identity contract enforced by GC.
	taskID := dirName
	if i := strings.LastIndex(dirName, "-"); i >= 0 && i+1 < len(dirName) {
		taskID = dirName[i+1:]
	}
	owner, err := json.Marshal(execenv.EnvRootOwner{WorkspaceID: wsID, TaskID: taskID})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, ".task_owner"), owner, 0o644); err != nil {
		t.Fatal(err)
	}
	if meta != nil {
		data, _ := json.Marshal(meta)
		if err := os.WriteFile(filepath.Join(taskDir, ".gc_meta.json"), data, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return taskDir
}

// TestRunGC_StrandedTaskRootRecordsFollowTaskStatus guards the wiring AND the
// invariant that makes the sweep safe.
//
// A record whose env root never materialised has no other remover: cleanTaskDir
// only fires on a root it reclaims, and nothing else walks .task_roots. But
// absence of the root cannot authorise removal on its own — ResolveRootDir
// publishes the record BEFORE Prepare creates the directory, so a record that
// an aged-out re-dispatch is in the middle of reusing looks identical to a
// leftover. Deleting there hands the same task a second physical root, which is
// the orphaning the index exists to prevent.
//
// The age gate alone does not separate those two: an old record IS the state a
// stalled re-dispatch reads. Only the task's own status does, so the sweep asks
// the server and keeps anything non-terminal.
func TestRunGC_StrandedTaskRootRecordsFollowTaskStatus(t *testing.T) {
	root := t.TempDir()
	const workspaceID = "a05b0e10-ee7a-4603-a72d-a548b2390cb2"
	params := func(taskID string) execenv.RootDirParams {
		return execenv.RootDirParams{
			WorkspacesRoot: root, WorkspaceID: workspaceID,
			WorkspaceSlug: "Asset Feed", TaskID: taskID,
		}
	}
	const (
		runningTask  = "5c57b65b-ee7a-4603-a72d-c760d45b2ed4"
		terminalTask = "5c57b65b-ee7a-4603-a72d-d871e56c3fe5"
		liveRootTask = "5c57b65b-ee7a-4603-a72d-b659c34a1dc3"
	)
	statuses := map[string]string{
		runningTask:  "running",
		terminalTask: "completed",
		// liveRootTask is terminal too: only its surviving root protects it.
		liveRootTask: "completed",
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/daemon/tasks/", func(w http.ResponseWriter, r *http.Request) {
		taskID := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/daemon/tasks/"), "/gc-check")
		status, ok := statuses[taskID]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"status": status})
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.WorkspacesRoot = root

	frozen := map[string]string{}
	for _, taskID := range []string{runningTask, terminalTask, liveRootTask} {
		resolved, err := execenv.ResolveRootDir(params(taskID))
		if err != nil {
			t.Fatalf("resolve root for %s: %v", taskID, err)
		}
		frozen[taskID] = resolved
	}
	// Only this one ever reached ClaimEnvRoot.
	if err := os.MkdirAll(frozen[liveRootTask], 0o755); err != nil {
		t.Fatalf("create live root: %v", err)
	}

	past := time.Now().Add(-31 * 24 * time.Hour)
	if err := filepath.WalkDir(filepath.Join(root, ".task_roots"), func(path string, _ fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return os.Chtimes(path, past, past)
	}); err != nil {
		t.Fatalf("backdate task root index: %v", err)
	}

	d.runGC(context.Background())

	// Renaming is how we observe survival: a frozen record ignores the new
	// labels, a reclaimed one re-proposes from them.
	for _, tc := range []struct {
		taskID string
		want   bool
		why    string
	}{
		{runningTask, true, "a non-terminal task's frozen identity was swept; a re-dispatch would now get a second root"},
		{liveRootTask, true, "a record was swept while its env root still exists"},
		{terminalTask, false, "a terminal task's stranded record survived the sweep"},
	} {
		renamed := params(tc.taskID)
		renamed.WorkspaceSlug = "Renamed Workspace"

		resolved, err := execenv.ResolveRootDir(renamed)
		if err != nil {
			t.Fatalf("resolve %s after GC: %v", tc.taskID, err)
		}
		if kept := resolved == frozen[tc.taskID]; kept != tc.want {
			t.Errorf("task %s: record kept = %v, want %v — %s", tc.taskID, kept, tc.want, tc.why)
		}
	}
}

func TestRunGC_PrunesOnlyTerminalAbandonedTaskRootRecords(t *testing.T) {
	t.Parallel()

	const (
		workspaceID     = "a05b0e10-ee7a-4603-a72d-a548b2390cb2"
		terminalTask    = "5c57b65b-ee7a-4603-a72d-b659c34a1dc3"
		runningTask     = "6d68c76c-ff8b-5704-b83e-c76ad45b2ed4"
		unavailableTask = "7e79d87d-008c-6805-c94f-d87be56c3fe5"
	)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/daemon/tasks/", func(w http.ResponseWriter, r *http.Request) {
		status := "running"
		parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
		if len(parts) >= 2 && parts[len(parts)-2] == unavailableTask {
			http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
			return
		}
		if len(parts) >= 2 && parts[len(parts)-2] == terminalTask {
			status = "failed"
		}
		json.NewEncoder(w).Encode(map[string]any{"status": status})
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.GCOrphanTTL = time.Hour
	terminalParams := execenv.RootDirParams{
		WorkspacesRoot: d.cfg.WorkspacesRoot,
		WorkspaceID:    workspaceID,
		TaskID:         terminalTask,
	}
	runningParams := terminalParams
	runningParams.TaskID = runningTask
	unavailableParams := terminalParams
	unavailableParams.TaskID = unavailableTask
	terminalRoot, err := execenv.ResolveRootDir(terminalParams)
	if err != nil {
		t.Fatalf("resolve terminal root: %v", err)
	}
	runningRoot, err := execenv.ResolveRootDir(runningParams)
	if err != nil {
		t.Fatalf("resolve running root: %v", err)
	}
	unavailableRoot, err := execenv.ResolveRootDir(unavailableParams)
	if err != nil {
		t.Fatalf("resolve unavailable root: %v", err)
	}

	indexDir := filepath.Join(d.cfg.WorkspacesRoot, ".task_roots")
	entries, err := os.ReadDir(indexDir)
	if err != nil {
		t.Fatalf("read task root index: %v", err)
	}
	old := time.Now().Add(-2 * time.Hour)
	for _, entry := range entries {
		recordPath := filepath.Join(indexDir, entry.Name(), "root.json")
		if err := os.Chtimes(recordPath, old, old); err != nil {
			t.Fatalf("age task root record: %v", err)
		}
	}

	d.runGC(t.Context())

	terminalRenamed := terminalParams
	terminalRenamed.WorkspaceSlug = "Renamed Workspace"

	terminalAfterGC, err := execenv.ResolveRootDir(terminalRenamed)
	if err != nil {
		t.Fatalf("resolve terminal root after GC: %v", err)
	}
	if terminalAfterGC == terminalRoot {
		t.Fatalf("terminal abandoned record still froze root %q", terminalAfterGC)
	}
	runningRenamed := runningParams
	runningRenamed.WorkspaceSlug = "Renamed Workspace"

	runningAfterGC, err := execenv.ResolveRootDir(runningRenamed)
	if err != nil {
		t.Fatalf("resolve running root after GC: %v", err)
	}
	if runningAfterGC != runningRoot {
		t.Fatalf("GC changed non-terminal task root from %q to %q", runningRoot, runningAfterGC)
	}
	unavailableRenamed := unavailableParams
	unavailableRenamed.WorkspaceSlug = "Renamed Workspace"

	unavailableAfterGC, err := execenv.ResolveRootDir(unavailableRenamed)
	if err != nil {
		t.Fatalf("resolve unavailable root after GC: %v", err)
	}
	if unavailableAfterGC != unavailableRoot {
		t.Fatalf("GC changed task root after an inconclusive status check from %q to %q", unavailableRoot, unavailableAfterGC)
	}
}

func TestShouldCleanTaskDir_DoneButRecentSkipped(t *testing.T) {
	t.Parallel()
	chatID := "44444444-4444-4444-4444-444444444444"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":     "archived",
			"updated_at": time.Now().Add(-1 * 24 * time.Hour), // 1 day ago, within TTL
		})
	})

	d := newGCTestDaemon(t, mux)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task4", &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws1",
		CompletedAt:   time.Now(),
	})

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionSkip {
		t.Fatalf("expected gcActionSkip for recently archived chat, got %d", action)
	}
}

func TestShouldCleanTaskDir_NoMetaRecentSkipped(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	// No meta, fresh directory — should skip.
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task5", nil)

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionSkip {
		t.Fatalf("expected gcActionSkip for recent orphan, got %d", action)
	}
}

func TestShouldCleanTaskDir_NoMetaOldOrphan(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	d.cfg.GCOrphanTTL = 0 // treat all orphans as expired
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task6", nil)

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionOrphan {
		t.Fatalf("expected gcActionOrphan, got %d", action)
	}
}

func TestShouldCleanTaskDir_APIErrorSkipped(t *testing.T) {
	t.Parallel()
	chatID := "55555555-5555-5555-5555-555555555555"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.GCCompletedTaskTTL = time.Hour
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "task7", &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws1",
		CompletedAt:   time.Now().Add(-2 * time.Hour),
	})

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action != gcActionSkip {
		t.Fatalf("expected gcActionSkip on API error despite completed-task TTL, got %d", action)
	}
}

func TestCleanTaskDir_RemovesDirectory(t *testing.T) {
	t.Parallel()
	d := newGCTestDaemon(t, http.NewServeMux())
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "doomed", nil)
	writeFile(t, filepath.Join(taskDir, "workdir", "payload.bin"), 64)

	if _, err := os.Stat(taskDir); err != nil {
		t.Fatal("task dir should exist before cleanup")
	}

	if bytes, removed := d.cleanTaskDir(taskDir); !removed || bytes < 64 {
		t.Fatalf("reclaimed bytes = %d, want at least payload size", bytes)
	}

	if _, err := os.Stat(taskDir); !os.IsNotExist(err) {
		t.Fatal("task dir should be removed after cleanup")
	}
}

func TestRunGC_SharedRootPreservesForeignDirectories(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	d.cfg.GCOrphanTTL = 0
	projectDir := filepath.Join(d.cfg.WorkspacesRoot, "analyze-serenity-event-study-20260827")
	dataDir := filepath.Join(projectDir, "data")
	database := filepath.Join(dataDir, "research.sqlite")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(database, []byte("do not delete"), 0o644); err != nil {
		t.Fatal(err)
	}

	d.runGC(context.Background())

	if got, err := os.ReadFile(database); err != nil || string(got) != "do not delete" {
		t.Fatalf("GC mutated non-Auro data under a shared root: data=%q err=%v", got, err)
	}
}

// The incident regression above only proves the no-meta orphan path returns
// early. applyGCAction is the single gate every mutating action passes
// through, so pin all four: an unowned directory must survive full cleanup,
// orphan removal, pattern artifact cleanup and managed artifact cleanup alike.
func TestApplyGCAction_RefusesEveryMutationWithoutOwner(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name   string
		action gcAction
	}{
		{"clean", gcActionClean},
		{"orphan", gcActionOrphan},
		{"artifacts", gcActionCleanArtifacts},
		{"managed artifacts", gcActionCleanManagedArtifacts},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			d := newGCTestDaemon(t, http.NewServeMux())
			taskDir := filepath.Join(d.cfg.WorkspacesRoot, "source-repository", "data")
			// Give both artifact actions something they would delete if the
			// ownership gate were absent, so a passing test means refusal
			// rather than an empty fixture.
			artifactDir := filepath.Join(taskDir, d.cfg.GCArtifactPatterns[0])
			managedDir := filepath.Join(taskDir, execenv.ManagedReclaimableArtifactSubpaths()[0])
			for _, dir := range []string{artifactDir, managedDir} {
				if err := os.MkdirAll(dir, 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(dir, "payload"), []byte("keep"), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			database := filepath.Join(taskDir, "research.sqlite")
			if err := os.WriteFile(database, []byte("do not delete"), 0o644); err != nil {
				t.Fatal(err)
			}

			stats := &gcStats{byPattern: map[string]int{}}
			if removed := d.applyGCAction(taskDir, tc.action, stats); removed != 0 {
				t.Fatalf("applyGCAction reported %d removals on an unowned directory", removed)
			}
			if stats.cleaned != 0 || stats.orphaned != 0 || stats.artifactDirs != 0 || stats.bytesReclaimed != 0 {
				t.Fatalf("unowned mutation was counted: cleaned=%d orphaned=%d artifactDirs=%d bytes=%d",
					stats.cleaned, stats.orphaned, stats.artifactDirs, stats.bytesReclaimed)
			}
			for _, path := range []string{database, filepath.Join(artifactDir, "payload"), filepath.Join(managedDir, "payload")} {
				if _, err := os.Stat(path); err != nil {
					t.Fatalf("unowned content was mutated: %s: %v", path, err)
				}
			}
		})
	}
}

func TestCleanTaskDir_RefusesOwnerPathMismatch(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	taskDir := filepath.Join(d.cfg.WorkspacesRoot, "source-repository", "data")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	owner, err := json.Marshal(execenv.EnvRootOwner{WorkspaceID: "workspace-id", TaskID: "task-id"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, ".task_owner"), owner, 0o644); err != nil {
		t.Fatal(err)
	}
	survivor := filepath.Join(taskDir, "research.sqlite")
	if err := os.WriteFile(survivor, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}

	if bytes, removed := d.cleanTaskDir(taskDir); removed || bytes != 0 {
		t.Fatalf("cleanTaskDir removed owner/path mismatch: removed=%v bytes=%d", removed, bytes)
	}
	if _, err := os.Stat(survivor); err != nil {
		t.Fatalf("owner/path mismatch data was not preserved: %v", err)
	}
}

func TestCleanTaskDir_AcceptsLegacyOwnerWithGCWorkspaceIdentity(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	taskDir := filepath.Join(d.cfg.WorkspacesRoot, "ws1", "task1")
	if err := os.MkdirAll(taskDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, ".task_owner"), []byte("task1"), 0o644); err != nil {
		t.Fatal(err)
	}
	meta, err := json.Marshal(execenv.GCMeta{Kind: execenv.GCKindChat, WorkspaceID: "ws1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, ".gc_meta.json"), meta, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(taskDir, "payload"), []byte("owned"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, removed := d.cleanTaskDir(taskDir); !removed {
		t.Fatal("legacy task owner with matching GC workspace identity was not removed")
	}
	if _, err := os.Stat(taskDir); !os.IsNotExist(err) {
		t.Fatalf("legacy owned task directory still exists: %v", err)
	}
}

func TestCleanTaskDir_RemovesStableRootRecord(t *testing.T) {
	t.Parallel()

	root := t.TempDir()
	params := execenv.PrepareParams{
		WorkspacesRoot: root,
		WorkspaceID:    "a05b0e10-ee7a-4603-a72d-a548b2390cb2",
		WorkspaceSlug:  "Asset Feed",
		TaskID:         "5c57b65b-ee7a-4603-a72d-b659c34a1dc3",

		AgentName: "GC Identity",
	}
	env, err := execenv.Prepare(params, slog.Default())
	if err != nil {
		t.Fatalf("Prepare: %v", err)
	}
	original := env.RootDir
	d := &Daemon{cfg: Config{WorkspacesRoot: root}, logger: slog.Default()}
	if bytes, removed := d.cleanTaskDir(original); !removed || bytes <= 0 {
		t.Fatalf("reclaimed bytes = %d, want owner metadata bytes", bytes)
	}

	resolved, err := execenv.ResolveRootDir(execenv.RootDirParams{
		WorkspacesRoot: root,
		WorkspaceID:    params.WorkspaceID,
		WorkspaceSlug:  "Renamed Workspace",
		TaskID:         params.TaskID,
	})
	if err != nil {
		t.Fatalf("ResolveRootDir after terminal GC: %v", err)
	}
	if resolved == original {
		t.Fatalf("terminal GC left stale root record %q", resolved)
	}
}

func TestShouldCleanTaskDir_CompletedTaskTTLPreservesActiveEnv(t *testing.T) {
	t.Parallel()
	chatID := "88888888-8888-8888-8888-888888888883"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"status": "active", "updated_at": time.Now(),
		})
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.GCCompletedTaskTTL = time.Hour
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-completed", &execenv.GCMeta{
		Kind: execenv.GCKindChat, ChatSessionID: chatID, WorkspaceID: "ws1",
		CompletedAt: time.Now().Add(-2 * time.Hour),
	})
	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected active env to remain despite completed-task TTL, got %d", action)
	}
}

func TestShouldCleanTaskDir_ActiveEnvRootSkipsArtifactCleanup(t *testing.T) {
	t.Parallel()
	chatID := "88888888-8888-8888-8888-88888888888a"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":     "active",
			"updated_at": time.Now(),
		})
	})

	d := newGCTestDaemon(t, mux)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-task", &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws1",
		CompletedAt:   time.Now().Add(-24 * time.Hour),
	})

	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip while task is active, got %d", action)
	}
}

func TestShouldCleanTaskDir_ActiveEnvRootSkipsFullCleanup(t *testing.T) {
	t.Parallel()
	chatID := "99999999-9999-9999-9999-999999999999"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		// Done long enough ago to satisfy GCTTL — this would normally return
		// gcActionClean. But the env root is in use (e.g. a re-dispatched task
		// reuses the prior workdir of an already-done issue whose updated_at is
		// still stale, since a task re-claim doesn't advance it). Active-root
		// guard must override.
		json.NewEncoder(w).Encode(map[string]any{
			"status":     "archived",
			"updated_at": time.Now().Add(-30 * 24 * time.Hour),
		})
	})

	d := newGCTestDaemon(t, mux)
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-done", &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws1",
		CompletedAt:   time.Now().Add(-30 * 24 * time.Hour),
	})

	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip on active env root with archived chat, got %d", action)
	}
}

func TestShouldCleanTaskDir_ActiveEnvRootSkipsOrphan404(t *testing.T) {
	t.Parallel()
	chatID := "99999999-9999-9999-9999-99999999999a"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		w.Write([]byte(`{"error":"not found"}`))
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.GCOrphanTTL = 0 // would normally make this an immediate orphan delete
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-404", &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws1",
		CompletedAt:   time.Now(),
	})

	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip on active env root with 404 chat, got %d", action)
	}
}

func TestShouldCleanTaskDir_ActiveEnvRootSkipsNoMetaOrphan(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	d.cfg.GCOrphanTTL = 0
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "active-no-meta", nil)

	d.markActiveEnvRoot(taskDir)
	defer d.unmarkActiveEnvRoot(taskDir)

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip on active env root with no-meta orphan, got %d", action)
	}
}

func TestShouldCleanTaskDir_ArtifactTTLDisabled(t *testing.T) {
	t.Parallel()
	chatID := "88888888-8888-8888-8888-88888888888b"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"status":     "active",
			"updated_at": time.Now(),
		})
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.GCArtifactTTL = 0
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "no-artifact-gc", &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws1",
		CompletedAt:   time.Now().Add(-100 * 24 * time.Hour),
	})

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected gcActionSkip when artifact GC disabled, got %d", action)
	}
}

func TestShouldCleanTaskDir_ArtifactTTLDisabledSkipsLocalOrphanManagedCleanup(t *testing.T) {
	t.Parallel()
	chatID := "88888888-8888-8888-8888-88888888888d"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.GCArtifactTTL = 0
	d.cfg.GCOrphanTTL = 0
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws1", "disabled-local-orphan", &execenv.GCMeta{
		Kind: execenv.GCKindChat, ChatSessionID: chatID, WorkspaceID: "ws1", LocalDirectory: true,
	})

	if action := d.shouldCleanTaskDir(context.Background(), taskDir); action != gcActionSkip {
		t.Fatalf("expected artifact TTL zero to disable managed local orphan cleanup, got %d", action)
	}
}

func TestCleanTaskArtifacts_RemovesOnlyMatchedDirs(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	taskDir := t.TempDir()

	// Create a synthetic project layout.
	mustMkdir := func(rel string) string {
		p := filepath.Join(taskDir, rel)
		if err := os.MkdirAll(p, 0o755); err != nil {
			t.Fatal(err)
		}
		return p
	}
	mustWrite := func(rel string, content string) {
		p := filepath.Join(taskDir, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	mustMkdir("workdir/repo/src")
	mustWrite("workdir/repo/src/index.ts", "console.log('hi')")
	mustMkdir("workdir/repo/.git/objects")
	mustWrite("workdir/repo/.git/objects/pack", "binary")
	mustMkdir("workdir/repo/node_modules/lodash")
	mustWrite("workdir/repo/node_modules/lodash/index.js", "module.exports = {}")
	mustMkdir("workdir/repo/.next/cache")
	mustWrite("workdir/repo/.next/cache/page.html", "<html></html>")
	mustMkdir("workdir/repo/.turbo")
	mustWrite("workdir/repo/.turbo/log", "trace")
	mustMkdir("workdir/repo/dist") // not in default patterns — must be preserved
	mustWrite("workdir/repo/dist/main.js", "compiled")
	mustWrite(".gc_meta.json", `{"issue_id":"x"}`)
	mustMkdir("output")
	mustWrite("output/result.txt", "done")

	removed, bytes, perPattern := d.cleanTaskArtifacts(taskDir, []string{"node_modules", ".next", ".turbo"})

	if removed != 3 {
		t.Fatalf("expected 3 artifact dirs removed, got %d", removed)
	}
	if bytes <= 0 {
		t.Fatalf("expected non-zero bytes reclaimed, got %d", bytes)
	}
	if perPattern["node_modules"] != 1 || perPattern[".next"] != 1 || perPattern[".turbo"] != 1 {
		t.Fatalf("unexpected per-pattern counts: %+v", perPattern)
	}

	// Verify protected paths are intact.
	for _, rel := range []string{
		"workdir/repo/src/index.ts",
		"workdir/repo/.git/objects/pack",
		"workdir/repo/dist/main.js",
		"output/result.txt",
		".gc_meta.json",
	} {
		if _, err := os.Stat(filepath.Join(taskDir, rel)); err != nil {
			t.Errorf("expected %s to be preserved, got %v", rel, err)
		}
	}

	// Verify removed paths are gone.
	for _, rel := range []string{
		"workdir/repo/node_modules",
		"workdir/repo/.next",
		"workdir/repo/.turbo",
	} {
		if _, err := os.Stat(filepath.Join(taskDir, rel)); !os.IsNotExist(err) {
			t.Errorf("expected %s to be removed, stat err=%v", rel, err)
		}
	}
}

func TestCleanTaskArtifacts_RejectsPatternsWithSeparators(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	taskDir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(taskDir, "workdir", "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}

	removed, _, _ := d.cleanTaskArtifacts(taskDir, []string{"workdir/node_modules", "../etc"})
	if removed != 0 {
		t.Fatalf("expected 0 removals from separator-bearing patterns, got %d", removed)
	}
	if _, err := os.Stat(filepath.Join(taskDir, "workdir", "node_modules")); err != nil {
		t.Fatalf("dir should still exist, got %v", err)
	}
}

func TestCleanTaskArtifacts_DoesNotFollowSymlinks(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	taskDir := t.TempDir()
	outside := t.TempDir()
	keepFile := filepath.Join(outside, "keep.txt")
	if err := os.WriteFile(keepFile, []byte("safe"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := os.MkdirAll(filepath.Join(taskDir, "workdir"), 0o755); err != nil {
		t.Fatal(err)
	}
	linkPath := filepath.Join(taskDir, "workdir", "node_modules")
	if err := os.Symlink(outside, linkPath); err != nil {
		t.Skipf("symlink not supported: %v", err)
	}

	removed, _, _ := d.cleanTaskArtifacts(taskDir, []string{"node_modules"})
	if removed != 0 {
		t.Fatalf("expected 0 removals (symlinked node_modules), got %d", removed)
	}
	if _, err := os.Stat(keepFile); err != nil {
		t.Fatalf("symlinked target was deleted: %v", err)
	}
}

func TestCleanTaskArtifacts_ManagedPathIsExactAndDeduplicated(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())

	t.Run("managed only", func(t *testing.T) {
		taskDir := t.TempDir()
		writeFile(t, filepath.Join(taskDir, "codex-home/.sandbox-bin/codex.exe"), 300)
		writeFile(t, filepath.Join(taskDir, "workdir/repo/.sandbox-bin/keep"), 400)
		writeFile(t, filepath.Join(taskDir, "codex-home/auth.json"), 10)

		removed, bytes, perPattern := d.cleanTaskArtifacts(taskDir, nil)
		if removed != 1 || bytes != 300 {
			t.Fatalf("removed=%d bytes=%d, want 1/300", removed, bytes)
		}
		if perPattern[managedArtifactPatternPrefix+"codex-home/.sandbox-bin"] != 1 {
			t.Fatalf("unexpected per-pattern stats: %+v", perPattern)
		}
		for _, rel := range []string{"workdir/repo/.sandbox-bin/keep", "codex-home/auth.json"} {
			if _, err := os.Stat(filepath.Join(taskDir, filepath.FromSlash(rel))); err != nil {
				t.Errorf("expected %s to be preserved: %v", rel, err)
			}
		}
	})

	t.Run("explicit broad basename", func(t *testing.T) {
		taskDir := t.TempDir()
		writeFile(t, filepath.Join(taskDir, "codex-home/.sandbox-bin/codex.exe"), 300)
		writeFile(t, filepath.Join(taskDir, "workdir/repo/.sandbox-bin/cache"), 400)

		removed, bytes, perPattern := d.cleanTaskArtifacts(taskDir, []string{".sandbox-bin"})
		if removed != 2 || bytes != 700 {
			t.Fatalf("removed=%d bytes=%d, want 2/700 without double counting", removed, bytes)
		}
		if perPattern[managedArtifactPatternPrefix+"codex-home/.sandbox-bin"] != 1 || perPattern[".sandbox-bin"] != 1 {
			t.Fatalf("unexpected per-pattern stats: %+v", perPattern)
		}
	})
}

func TestCleanTaskArtifacts_ManagedPathDoesNotFollowSymlinks(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())

	for _, tc := range []struct {
		name     string
		linkPath string
	}{
		{name: "leaf", linkPath: "codex-home/.sandbox-bin"},
		{name: "parent", linkPath: "codex-home"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			taskDir := t.TempDir()
			outside := t.TempDir()
			keepFile := filepath.Join(outside, "keep")
			writeFile(t, keepFile, 10)
			linkPath := filepath.Join(taskDir, filepath.FromSlash(tc.linkPath))
			if err := os.MkdirAll(filepath.Dir(linkPath), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, linkPath); err != nil {
				t.Skipf("symlink not supported: %v", err)
			}

			removed, _, _ := d.cleanTaskArtifacts(taskDir, nil)
			if removed != 0 {
				t.Fatalf("removed=%d, want 0 for symlinked managed path", removed)
			}
			if _, err := os.Stat(keepFile); err != nil {
				t.Fatalf("symlink target was touched: %v", err)
			}
		})
	}
}

func TestActiveEnvRootRefcount(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	root := "/tmp/fake/env"

	if d.isActiveEnvRoot(root) {
		t.Fatal("expected inactive before mark")
	}
	d.markActiveEnvRoot(root)
	d.markActiveEnvRoot(root) // second mark from reuse path
	if !d.isActiveEnvRoot(root) {
		t.Fatal("expected active after mark")
	}
	d.unmarkActiveEnvRoot(root)
	if !d.isActiveEnvRoot(root) {
		t.Fatal("expected still active after one unmark")
	}
	d.unmarkActiveEnvRoot(root)
	if d.isActiveEnvRoot(root) {
		t.Fatal("expected inactive after both unmarks")
	}
}

func TestReserveEnvRootForGCIsExclusive(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	root := "/tmp/fake/gc-reservation"

	d.markActiveEnvRoot(root)
	if _, ok := d.reserveEnvRootForGC(root); ok {
		t.Fatal("GC reservation must fail while a task is active")
	}
	d.unmarkActiveEnvRoot(root)

	release, ok := d.reserveEnvRootForGC(root)
	if !ok {
		t.Fatal("expected GC reservation for inactive env root")
	}
	if _, ok := d.reserveEnvRootForGC(root); ok {
		t.Fatal("second GC reservation must fail while the first is held")
	}
	release()

	release, ok = d.reserveEnvRootForGC(root)
	if !ok {
		t.Fatal("expected GC reservation after release")
	}
	release()
}

func TestIsBareRepo(t *testing.T) {
	t.Parallel()

	t.Run("valid bare repo", func(t *testing.T) {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "HEAD"), []byte("ref: refs/heads/main"), 0o644)
		os.MkdirAll(filepath.Join(dir, "objects"), 0o755)
		if !isBareRepo(dir) {
			t.Fatal("expected isBareRepo=true for dir with HEAD + objects/")
		}
	})

	t.Run("HEAD only", func(t *testing.T) {
		dir := t.TempDir()
		os.WriteFile(filepath.Join(dir, "HEAD"), []byte("ref: refs/heads/main"), 0o644)
		if isBareRepo(dir) {
			t.Fatal("expected isBareRepo=false for dir with only HEAD")
		}
	})

	t.Run("empty dir", func(t *testing.T) {
		dir := t.TempDir()
		if isBareRepo(dir) {
			t.Fatal("expected isBareRepo=false for empty dir")
		}
	})
}

func TestPruneWorktree_RemovesOnlyStaleAgentBranches(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")

	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)

	activeWorktree := filepath.Join(t.TempDir(), "active")
	activeBranch := "agent/live/12345678"
	staleBranch := "agent/stale/87654321"
	keepBranch := "main"

	runGitForGC(t, "", "-C", barePath, "worktree", "add", "-b", activeBranch, activeWorktree, "HEAD")
	runGitForGC(t, "", "-C", barePath, "branch", staleBranch, "HEAD")

	d.pruneWorktree(barePath)

	if gitRefExists(t, barePath, "refs/heads/"+staleBranch) {
		t.Fatalf("expected stale branch %q to be deleted", staleBranch)
	}
	if !gitRefExists(t, barePath, "refs/heads/"+activeBranch) {
		t.Fatalf("expected active branch %q to be preserved", activeBranch)
	}
	if !gitRefExists(t, barePath, "refs/heads/"+keepBranch) {
		t.Fatalf("expected non-agent branch %q to be preserved", keepBranch)
	}
}

func TestMaintainRepoCacheRunsLightCleanupWhileTaskActive(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")
	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)
	const staleBranch = "agent/stale/87654321"
	runGitForGC(t, "", "-C", barePath, "branch", staleBranch, "HEAD")

	d.activeTasks.Add(1)
	defer d.activeTasks.Add(-1)
	d.maintainRepoCache(context.Background(), barePath, &gcStats{})

	if gitRefExists(t, barePath, "refs/heads/"+staleBranch) {
		t.Fatalf("expected stale branch %q to be deleted while a task is active", staleBranch)
	}
	if _, err := os.Stat(filepath.Join(barePath, repoMaintenanceMarker)); err != nil {
		t.Fatalf("heavy maintenance should remain pending while a task is active: %v", err)
	}
}

// TestPruneWorktree_IgnoresLiteralAgentBranch ensures the GC pattern is scoped
// to the `agent/` namespace. A repo whose only `agent`-shaped ref is the
// literal `refs/heads/agent` (no slash) must be left untouched — the
// `for-each-ref` query is narrowed to `refs/heads/agent/` for that reason.
func TestPruneWorktree_IgnoresLiteralAgentBranch(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")

	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)
	runGitForGC(t, "", "-C", barePath, "branch", "agent", "HEAD")

	d.pruneWorktree(barePath)

	if !gitRefExists(t, barePath, "refs/heads/agent") {
		t.Fatal("expected literal `agent` branch outside the daemon namespace to be preserved")
	}
}

// TestPruneWorktree_SkipsMaintenanceWhenNothingDeleted pins the gate that
// keeps the heavy `gc --prune` step from running on every GC tick. Uses an
// unreachable loose blob backdated past the prune horizon as a sentinel: it
// survives when no agent branch was deleted (no maintenance), and disappears
// once a stale agent branch is reaped (maintenance ran).
func TestPruneWorktree_SkipsMaintenanceWhenNothingDeleted(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")

	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)

	// Park an active agent worktree so the scan has something to filter, and
	// to make sure pruneWorktree exercises the full code path.
	activeWorktree := filepath.Join(t.TempDir(), "active")
	runGitForGC(t, "", "-C", barePath, "worktree", "add", "-b", "agent/live/12345678", activeWorktree, "HEAD")

	sentinelPath := writeOldLooseBlob(t, barePath, "sentinel-content", 60*24*time.Hour)

	// No stale agent branch → no deletion → no `gc --prune`. The sentinel
	// blob must survive.
	d.pruneWorktree(barePath)
	if _, err := os.Stat(sentinelPath); err != nil {
		t.Fatalf("expected sentinel blob to survive when nothing was deleted: %v", err)
	}

	// Introduce a stale agent branch → deletion happens → maintenance runs →
	// `gc --prune=30.days` reaps the sentinel blob.
	runGitForGC(t, "", "-C", barePath, "branch", "agent/stale/87654321", "HEAD")
	d.pruneWorktree(barePath)
	if _, err := os.Stat(sentinelPath); !os.IsNotExist(err) {
		t.Fatalf("expected sentinel blob to be pruned after maintenance ran, stat err=%v", err)
	}
}

func TestPruneWorktree_RetriesPendingMaintenanceWithoutAnotherBranchDeletion(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	sourceRepo := createGCGitRepo(t)
	barePath := filepath.Join(t.TempDir(), "cache.git")
	runGitForGC(t, "", "clone", "--bare", sourceRepo, barePath)

	sentinelPath := writeOldLooseBlob(t, barePath, "pending-maintenance", 60*24*time.Hour)
	markerPath := filepath.Join(barePath, repoMaintenanceMarker)
	if err := os.WriteFile(markerPath, []byte("pending\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	d.pruneWorktree(barePath)
	if _, err := os.Stat(sentinelPath); !os.IsNotExist(err) {
		t.Fatalf("expected pending maintenance to prune sentinel, stat err=%v", err)
	}
	if _, err := os.Stat(markerPath); !os.IsNotExist(err) {
		t.Fatalf("expected completed maintenance to clear pending marker, stat err=%v", err)
	}
}

// writeOldLooseBlob writes a dangling loose-object blob to the bare repo and
// backdates its mtime so `git gc --prune=30.days` will consider it prunable.
// Returns the absolute path to the loose object on disk.
func writeOldLooseBlob(t *testing.T, barePath, content string, age time.Duration) string {
	t.Helper()
	cmd := exec.Command("git", "-C", barePath, "hash-object", "-w", "--stdin")
	cmd.Stdin = strings.NewReader(content)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("hash-object failed: %v: %s", err, out)
	}
	sha := strings.TrimSpace(string(out))
	if len(sha) < 4 {
		t.Fatalf("unexpected sha output: %q", sha)
	}
	loose := filepath.Join(barePath, "objects", sha[:2], sha[2:])
	if _, err := os.Stat(loose); err != nil {
		t.Fatalf("expected loose object at %s: %v", loose, err)
	}
	old := time.Now().Add(-age)
	if err := os.Chtimes(loose, old, old); err != nil {
		t.Fatalf("chtimes failed: %v", err)
	}
	return loose
}

func TestPruneWorktree_LegacyCacheFallbackSerializesWithCreateWorktree(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	sourceRepo := createGCGitRepo(t)
	cache := repocache.New(filepath.Join(d.cfg.WorkspacesRoot, ".repos"), slog.Default())
	if err := cache.Sync("ws1", []repocache.RepoInfo{{URL: sourceRepo}}); err != nil {
		t.Fatalf("cache sync failed: %v", err)
	}

	barePath := cache.Lookup("ws1", sourceRepo)
	if barePath == "" {
		t.Fatal("expected bare repo to be cached")
	}

	runGitForGC(t, "", "-C", barePath, "branch", "agent/stale/87654321", "HEAD")

	blockingCache := &blockingRepoCache{
		inner:   cache,
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	d.repoCache = blockingCache

	pruneDone := make(chan struct{})
	go func() {
		d.pruneWorktree(barePath)
		close(pruneDone)
	}()

	select {
	case <-blockingCache.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for pruneWorktree to acquire repo lock")
	}

	createDone := make(chan error, 1)
	go func() {
		_, err := blockingCache.CreateWorktree(repocache.WorktreeParams{
			WorkspaceID: "ws1",
			RepoURL:     sourceRepo,
			WorkDir:     t.TempDir(),
			AgentName:   "tester",
			TaskID:      "11111111-1111-1111-1111-111111111111",
		})
		createDone <- err
	}()

	select {
	case err := <-createDone:
		t.Fatalf("CreateWorktree should wait for GC lock, returned early with err=%v", err)
	case <-time.After(200 * time.Millisecond):
	}

	close(blockingCache.release)

	select {
	case err := <-createDone:
		if err != nil {
			t.Fatalf("CreateWorktree failed after GC lock released: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for CreateWorktree after releasing GC lock")
	}

	select {
	case <-pruneDone:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for pruneWorktree to finish")
	}
}

func TestCleanupNewRepoMaintenanceLocksPreservesPreexistingFiles(t *testing.T) {
	t.Parallel()

	d := newGCTestDaemon(t, http.NewServeMux())
	barePath := t.TempDir()
	preexisting := filepath.Join(barePath, "logs", "refs", "heads", "main.lock")
	if err := os.MkdirAll(filepath.Dir(preexisting), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preexisting, []byte("existing"), 0o644); err != nil {
		t.Fatal(err)
	}
	before := snapshotRepoMaintenanceLocks(barePath)

	created := []string{
		filepath.Join(barePath, "refs", "remotes", "origin", "main.lock"),
		filepath.Join(barePath, "objects", "pack", "multi-pack-index.lock"),
		filepath.Join(barePath, "packed-refs.lock"),
		filepath.Join(barePath, "gc.pid"),
	}
	for _, path := range created {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("new"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	outsideWhitelist := filepath.Join(barePath, "hooks", "user.lock")
	if err := os.MkdirAll(filepath.Dir(outsideWhitelist), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outsideWhitelist, []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}

	d.cleanupNewRepoMaintenanceLocks(barePath, before)
	for _, path := range created {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("new maintenance lock %s survived, stat error = %v", path, err)
		}
	}
	for _, path := range []string{preexisting, outsideWhitelist} {
		if _, err := os.Stat(path); err != nil {
			t.Errorf("unowned lock %s was removed: %v", path, err)
		}
	}
}

func TestPruneWorktreePreemptionCleansLocksBeforeTaskStarts(t *testing.T) {
	if _, err := os.Stat("/bin/sh"); err != nil {
		t.Skipf("requires a POSIX shell: %v", err)
	}
	realGit, err := exec.LookPath("git")
	if err != nil {
		t.Skipf("git not found: %v", err)
	}

	d := newGCTestDaemon(t, http.NewServeMux())
	sourceRepo := createGCGitRepo(t)
	cache := repocache.New(filepath.Join(d.cfg.WorkspacesRoot, ".repos"), slog.Default())
	if err := cache.Sync("ws1", []repocache.RepoInfo{{URL: sourceRepo}}); err != nil {
		t.Fatalf("cache sync failed: %v", err)
	}
	d.repoCache = cache
	barePath := cache.Lookup("ws1", sourceRepo)
	runGitForGC(t, "", "-C", barePath, "branch", "agent/stale/87654321", "HEAD")

	lockPath := filepath.Join(barePath, "refs", "remotes", "origin", "main.lock")
	if err := os.MkdirAll(filepath.Dir(lockPath), 0o755); err != nil {
		t.Fatal(err)
	}
	startedPath := filepath.Join(t.TempDir(), "maintenance-started")
	binDir := t.TempDir()
	fakeGit := filepath.Join(binDir, "git")
	script := `#!/bin/sh
if [ "$3" = "reflog" ] && [ "$4" = "expire" ]; then
  : > "$2/refs/remotes/origin/main.lock"
  : > "$AURO_TEST_MAINTENANCE_STARTED"
  trap 'exit 143' TERM INT
  while :; do sleep 1; done
fi
exec "$AURO_TEST_REAL_GIT" "$@"
`
	if err := os.WriteFile(fakeGit, []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AURO_TEST_REAL_GIT", realGit)
	t.Setenv("AURO_TEST_MAINTENANCE_STARTED", startedPath)
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	pruneDone := make(chan struct{})
	go func() {
		d.pruneWorktree(barePath)
		close(pruneDone)
	}()
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(startedPath); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for heavy maintenance to start")
		}
		time.Sleep(10 * time.Millisecond)
	}

	// Match production task dispatch order: mark the task active, then cancel
	// maintenance and wait for its cleanup barrier before agent code starts.
	d.activeTasks.Add(1)
	defer d.activeTasks.Add(-1)
	cache.CancelMaintenance()
	select {
	case <-pruneDone:
	case <-time.After(5 * time.Second):
		t.Fatal("pruneWorktree did not finish after preemption")
	}
	if _, err := os.Stat(lockPath); !os.IsNotExist(err) {
		t.Fatalf("maintenance lock survived real task preemption, stat error = %v", err)
	}
	if err := cache.Fetch(barePath); err != nil {
		t.Fatalf("fetch did not recover after preempted maintenance cleanup: %v", err)
	}
}

type blockingRepoCache struct {
	inner   *repocache.Cache
	entered chan struct{}
	release chan struct{}
}

func (c *blockingRepoCache) Lookup(workspaceID, url string) string {
	return c.inner.Lookup(workspaceID, url)
}

func (c *blockingRepoCache) BarePath(workspaceID, url string) string {
	return c.inner.BarePath(workspaceID, url)
}

func (c *blockingRepoCache) Sync(workspaceID string, repos []repocache.RepoInfo) error {
	return c.inner.Sync(workspaceID, repos)
}

func (c *blockingRepoCache) WithRepoLock(barePath string, fn func() error) error {
	return c.inner.WithRepoLock(barePath, func() error {
		close(c.entered)
		<-c.release
		return fn()
	})
}

func (c *blockingRepoCache) CreateWorktree(params repocache.WorktreeParams) (*repocache.WorktreeResult, error) {
	return c.inner.CreateWorktree(params)
}

func createGCGitRepo(t *testing.T) string {
	t.Helper()

	repoDir := t.TempDir()
	runGitForGC(t, repoDir, "init", "-b", "main")
	if err := os.WriteFile(filepath.Join(repoDir, "README.md"), []byte("hello\n"), 0o644); err != nil {
		t.Fatalf("write README: %v", err)
	}
	runGitForGC(t, repoDir, "add", "README.md")
	runGitForGC(t, repoDir, "commit", "-m", "initial commit")
	return repoDir
}

func runGitForGC(t *testing.T, dir string, args ...string) string {
	t.Helper()

	fullArgs := args
	if dir != "" {
		fullArgs = append([]string{"-C", dir}, args...)
	}
	cmd := exec.Command("git", fullArgs...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@test.com",
		"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@test.com",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %s failed: %s: %v", strings.Join(fullArgs, " "), out, err)
	}
	return strings.TrimSpace(string(out))
}

func gitRefExists(t *testing.T, repoPath, ref string) bool {
	t.Helper()

	cmd := exec.Command("git", "-C", repoPath, "show-ref", "--verify", "--quiet", ref)
	if err := cmd.Run(); err != nil {
		return false
	}
	return true
}

// TestShouldCleanTaskDir_ChatHardDeletedFreshMtime locks acceptance #3:
// when a user hard-deletes a chat session, the workdir must be reclaimed
// on the next GC cycle (≤ GCInterval), not deferred to GCOrphanTTL. A
// directory that was just created (mtime well within GCOrphanTTL) but
// whose chat session now 404s must therefore return gcActionClean.
func TestShouldCleanTaskDir_ChatHardDeletedFreshMtime(t *testing.T) {
	t.Parallel()
	chatID := "ffffffff-ffff-ffff-ffff-ffffffffff02"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		// Simulate hard-deleted session (DeleteChatSession ran).
		w.WriteHeader(http.StatusNotFound)
	})

	d := newGCTestDaemon(t, mux)
	// Crank GCOrphanTTL up so the mtime path is unmistakably not in play —
	// the only way the directory gets reclaimed is the chat-404 fast path.
	d.cfg.GCOrphanTTL = 365 * 24 * time.Hour
	meta := &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws",
		CompletedAt:   time.Now(),
	}
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws", "hard-deleted-chat", meta)
	// taskDir mtime is now-ish — well within any sane GCOrphanTTL.

	if got := d.shouldCleanTaskDir(context.Background(), taskDir); got != gcActionClean {
		t.Fatalf("hard-deleted chat with fresh mtime must clean immediately, got %d", got)
	}
}

// TestShouldCleanTaskDir_ChatActiveResistsOldMtime is the explicit acceptance
// criterion #2: an active chat session whose workdir is older than
// GCOrphanTTL must NOT be reclaimed. The only path to clean an active
// session's workdir is for the user to archive or hard-delete the session.
//
// #6782 narrowed this from "the GC does nothing" to "the GC never removes the
// directory": a session idle past GCArtifactTTL now gives back the regenerable
// codex-home/.sandbox-bin cache, which the next message re-provisions. The
// acceptance criterion is unchanged — the session's own data survives — so
// this asserts the surviving contents rather than the bare action value.
// TestManagedArtifact_IdleActiveChatReclaimsSandboxBin covers the carve-out.
func TestShouldCleanTaskDir_ChatActiveResistsOldMtime(t *testing.T) {
	t.Parallel()
	chatID := "ffffffff-ffff-ffff-ffff-ffffffffff01"

	mux := http.NewServeMux()
	mux.HandleFunc(fmt.Sprintf("/api/daemon/chat-sessions/%s/gc-check", chatID), func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status":     "active",
			"updated_at": time.Now().Add(-100 * 24 * time.Hour),
		})
	})

	d := newGCTestDaemon(t, mux)
	d.cfg.GCOrphanTTL = 0 // every directory is "older than orphan TTL"
	meta := &execenv.GCMeta{
		Kind:          execenv.GCKindChat,
		ChatSessionID: chatID,
		WorkspaceID:   "ws",
		CompletedAt:   time.Now().Add(-200 * 24 * time.Hour),
	}
	taskDir := createTaskDir(t, d.cfg.WorkspacesRoot, "ws", "active-chat", meta)
	writeFile(t, filepath.Join(taskDir, "logs/run.log"), 32)
	writeFile(t, filepath.Join(taskDir, "output/result.md"), 32)
	if err := os.Chtimes(taskDir, time.Now().Add(-200*24*time.Hour), time.Now().Add(-200*24*time.Hour)); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	action := d.shouldCleanTaskDir(context.Background(), taskDir)
	if action == gcActionClean || action == gcActionOrphan {
		t.Fatalf("active chat session's directory must never be removed, got action %d", action)
	}
	d.applyGCAction(taskDir, action, &gcStats{byPattern: map[string]int{}})

	for _, rel := range []string{".", "logs/run.log", "output/result.md", ".gc_meta.json"} {
		if _, err := os.Stat(filepath.Join(taskDir, rel)); err != nil {
			t.Fatalf("active chat session must keep %s: %v", rel, err)
		}
	}
}

// TestGCMetaForTask covers the discriminator priority used by the daemon
// when selecting which GCMetaKind to write at task completion.
func TestGCMetaForTask(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		task Task
		want execenv.GCMetaKind
		idOK func(m execenv.GCMeta) bool
	}{
		{
			name: "chat task",
			task: Task{ID: "t1", WorkspaceID: "ws", ChatSessionID: "c1"},
			want: execenv.GCKindChat,
			idOK: func(m execenv.GCMeta) bool { return m.ChatSessionID == "c1" },
		},
		{
			name: "autopilot run task",
			task: Task{ID: "t2", WorkspaceID: "ws", AutopilotRunID: "r1"},
			want: execenv.GCKindAutopilotRun,
			idOK: func(m execenv.GCMeta) bool { return m.AutopilotRunID == "r1" },
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			meta, ok := gcMetaForTask(tc.task)
			if !ok {
				t.Fatalf("expected gcMetaForTask to recognize task, got ok=false")
			}
			if meta.Kind != tc.want {
				t.Fatalf("kind: want %q, got %q", tc.want, meta.Kind)
			}
			if !tc.idOK(meta) {
				t.Fatalf("ID field mismatch: %+v", meta)
			}
			if meta.WorkspaceID != "ws" {
				t.Fatalf("workspace_id: want %q, got %q", "ws", meta.WorkspaceID)
			}
			if meta.TaskID != tc.task.ID {
				t.Fatalf("task_id: want %q, got %q", tc.task.ID, meta.TaskID)
			}
		})
	}

	t.Run("unrecognized task — ok=false", func(t *testing.T) {
		t.Parallel()
		_, ok := gcMetaForTask(Task{ID: "tX", WorkspaceID: "ws"})
		if ok {
			t.Fatal("expected gcMetaForTask to return ok=false for task with no IDs")
		}
	})
}
