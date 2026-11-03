package execenv

import (
	"testing"
)

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
	if prov.WorkspaceID != "ws-prov-chat" || prov.ChatSessionID != "chat-1" || prov.AgentID != "agent-chat" {
		t.Fatalf("chat provenance owner mismatch: %+v", prov)
	}
}
