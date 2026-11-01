package execenv

import (
	"os"
	"path/filepath"
	"testing"
)

// TestPrepareLocalDirectoryWritesNoProvenance pins the local_directory branch:
// a task bound to a user-supplied path must NOT get a managed-env provenance
// marker, so a squad leader can never treat the user's directory as a reusable
// managed workdir. Absence of the marker is the fail-closed signal.
func TestPrepareLocalDirectoryWritesNoProvenance(t *testing.T) {
	root := t.TempDir()
	localDir := t.TempDir()
	env, err := Prepare(PrepareParams{
		WorkspacesRoot: root,
		WorkspaceID:    "ws-prov-local",
		TaskID:         "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
		AgentName:      "Local Agent",
		LocalWorkDir:   localDir,
		Task: TaskContextForEnv{
			IssueID: "issue-prov-local",
			AgentID: "agent-prov-local",
		},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	if _, err := ReadManagedEnvProvenance(env.RootDir); !os.IsNotExist(err) {
		t.Fatalf("local_directory Prepare must not write managed env provenance; got err = %v", err)
	}
	// The user's own directory must never receive the marker either.
	if _, err := os.Stat(filepath.Join(localDir, managedEnvProvenanceFile)); !os.IsNotExist(err) {
		t.Fatal("managed env provenance leaked into the user's local directory")
	}
}

// TestPrepareManagedChatEnvWritesProvenance confirms chat reuse has the same
// ownership proof as issue reuse while remaining scoped to its conversation.
func TestPrepareManagedChatEnvWritesProvenance(t *testing.T) {
	root := t.TempDir()
	env, err := Prepare(PrepareParams{
		WorkspacesRoot: root,
		WorkspaceID:    "ws-prov-chat",
		TaskID:         "cccccccc-dddd-eeee-ffff-000000000000",
		AgentName:      "Chat Agent",
		Task: TaskContextForEnv{
			ChatSessionID: "chat-1",
			AgentID:       "agent-chat",
		},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	prov, err := ReadManagedEnvProvenance(env.RootDir)
	if err != nil {
		t.Fatalf("read chat managed env provenance: %v", err)
	}
	if prov.WorkspaceID != "ws-prov-chat" || prov.ChatSessionID != "chat-1" || prov.AgentID != "agent-chat" || prov.IssueID != "" {
		t.Fatalf("chat provenance owner mismatch: %+v", prov)
	}
}
