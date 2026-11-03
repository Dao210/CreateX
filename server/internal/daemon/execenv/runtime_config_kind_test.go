package execenv

import (
	"strings"
	"testing"
)

func TestRetainedTaskBriefContracts(t *testing.T) {
	cases := []struct {
		name    string
		context TaskContextForEnv
		kind    taskKind
		command string
	}{
		{"execution", TaskContextForEnv{}, kindExecution, "auro agent"},
		{"chat", TaskContextForEnv{ChatSessionID: "chat"}, kindChat, "auro chat"},
		{"automation", TaskContextForEnv{AutopilotRunID: "run"}, kindAutopilotRunOnly, "auro autopilot"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classifyTask(tc.context); got != tc.kind {
				t.Fatalf("kind=%v want=%v", got, tc.kind)
			}
			out := buildMetaSkillContent("claude", tc.context)
			for _, retired := range []string{"auro issue", "auro project", "auro squad", "Sub-issue Creation"} {
				if strings.Contains(out, retired) {
					t.Errorf("brief exposes retired workflow %q", retired)
				}
			}
			if !strings.Contains(out, tc.command) {
				t.Errorf("brief misses supported command %q", tc.command)
			}
		})
	}
}
