package execenv

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/pelletier/go-toml/v2"
)

// reasonixEnvWith writes a Reasonix user config.toml into a fresh home and
// returns the task env pointing at it, so a test never reads the machine's real
// Reasonix config.
func reasonixEnvWith(t *testing.T, config string) map[string]string {
	t.Helper()
	home := t.TempDir()
	if config != "" {
		if err := os.WriteFile(filepath.Join(home, reasonixUserConfigFile), []byte(config), 0o600); err != nil {
			t.Fatalf("seed reasonix user config: %v", err)
		}
	}
	return map[string]string{"REASONIX_HOME": home}
}

// assertTaskDenyList checks the deny rules in a written per-task reasonix.toml.
func assertTaskDenyList(t *testing.T, path string, want []string) {
	t.Helper()
	if got := taskDenyList(t, path); !slices.Equal(got, want) {
		t.Fatalf("deny = %v, want %v", got, want)
	}
}

// taskDenyList decodes the deny rules from a written per-task reasonix.toml.
func taskDenyList(t *testing.T, path string) []string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", reasonixProjectConfigFile, err)
	}
	var cfg struct {
		Permissions struct {
			Deny  []string `toml:"deny"`
			Allow []string `toml:"allow"`
		} `toml:"permissions"`
	}
	if err := toml.Unmarshal(data, &cfg); err != nil {
		t.Fatalf("parse written %s: %v\n%s", reasonixProjectConfigFile, err, data)
	}
	return cfg.Permissions.Deny
}

func TestPrepareDeniesReasonixAskTool(t *testing.T) {
	t.Parallel()
	env, err := Prepare(PrepareParams{
		WorkspacesRoot: t.TempDir(),
		WorkspaceID:    "ws-reasonix-001",
		TaskID:         "b1b2c3d4-e5f6-7890-abcd-ef1234567890",
		AgentName:      "Reasonix Agent",
		Provider:       "reasonix",
		ReasonixEnv:    reasonixEnvWith(t, ""),
		Task:           TaskContextForEnv{IssueID: "b1b2c3d4-e5f6-7890-abcd-ef1234567890"},
	}, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	configPath := filepath.Join(env.WorkDir, reasonixProjectConfigFile)
	if got := taskDenyList(t, configPath); !slices.Equal(got, []string{"ask"}) {
		t.Fatalf("deny = %v, want [ask]", got)
	}

	// The sidecar is daemon-owned state, so CleanupSidecars must take it back
	// out — a local_directory run has to be byte-exactly reversible.
	if err := CleanupSidecars(env.RootDir); err != nil {
		t.Fatalf("CleanupSidecars: %v", err)
	}
	if _, err := os.Stat(configPath); !os.IsNotExist(err) {
		t.Fatalf("reasonix.toml survived sidecar cleanup (stat err = %v)", err)
	}
}

func TestReuseRewritesReasonixAskDeny(t *testing.T) {
	t.Parallel()
	params := PrepareParams{
		WorkspacesRoot: t.TempDir(),
		WorkspaceID:    "ws-reasonix-003",
		TaskID:         "c1b2c3d4-e5f6-7890-abcd-ef1234567890",
		AgentName:      "Reasonix Agent",
		Provider:       "reasonix",
		ReasonixEnv:    reasonixEnvWith(t, "[permissions]\ndeny = [\"bash\"]\n"),
		Task:           TaskContextForEnv{IssueID: "c1b2c3d4-e5f6-7890-abcd-ef1234567890"},
	}
	env, err := Prepare(params, testLogger())
	if err != nil {
		t.Fatalf("Prepare failed: %v", err)
	}
	defer env.Cleanup(true)

	// Reuse rolls back the prior run's sidecars before rebuilding them, so the
	// deny rule has to be re-laid — otherwise the second turn of a task would
	// run with the ask tool available again.
	reused := Reuse(ReuseParams{
		WorkspacesRoot: params.WorkspacesRoot,
		WorkDir:        env.WorkDir,
		Provider:       "reasonix",
		ReasonixEnv:    params.ReasonixEnv,
		Task:           params.Task,
	}, testLogger())
	if reused == nil {
		t.Fatal("Reuse returned nil")
	}
	got := taskDenyList(t, filepath.Join(reused.WorkDir, reasonixProjectConfigFile))
	if !slices.Equal(got, []string{"bash", "ask"}) {
		t.Fatalf("deny after reuse = %v, want [bash ask]", got)
	}
}
