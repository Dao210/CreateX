package service

import (
	"testing"
	"time"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestAutopilotErrorType(t *testing.T) {
	cases := map[string]string{
		"unknown execution_mode: nope": "configuration",
		"issue blocked":                "issue_terminal",
		"issue cancelled":              "issue_terminal",
		"enqueue task: no runtime":     "dispatch_error",
		"task failed":                  "task_error",
		"unexpected":                   "autopilot_error",
	}

	for reason, want := range cases {
		if got := autopilotErrorType(reason); got != want {
			t.Fatalf("autopilotErrorType(%q) = %q, want %q", reason, got, want)
		}
	}
}

func TestTaskFailureReasonForAutopilotRun(t *testing.T) {
	cases := []struct {
		name string
		task db.AgentTaskQueue
		want string
	}{
		{
			name: "prefers raw error text",
			task: db.AgentTaskQueue{
				Error:         pgtype.Text{String: "tests failed", Valid: true},
				FailureReason: pgtype.Text{String: "agent_error", Valid: true},
			},
			want: "tests failed",
		},
		{
			name: "falls back to classified reason when error is blank",
			task: db.AgentTaskQueue{
				Error:         pgtype.Text{String: "   ", Valid: true},
				FailureReason: pgtype.Text{String: "codex_semantic_inactivity", Valid: true},
			},
			want: "codex_semantic_inactivity",
		},
		{
			name: "generic default when nothing is set",
			task: db.AgentTaskQueue{},
			want: "task failed",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := taskFailureReasonForAutopilotRun(tc.task); got != tc.want {
				t.Fatalf("taskFailureReasonForAutopilotRun() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestInterpolateTemplate_InvalidTriggerTimezoneFallsBackToUTC(t *testing.T) {
	s := &AutopilotService{}
	ap := db.Autopilot{
		Title:              "fallback",
		IssueTitleTemplate: pgtype.Text{String: "report {{date}}", Valid: true},
	}
	run := db.AutopilotRun{
		TriggeredAt: pgtype.Timestamptz{Time: time.Date(2026, 5, 26, 23, 30, 0, 0, time.UTC), Valid: true},
	}

	got := s.interpolateTemplate(ap, run, "Foo/Bar")
	if want := "report 2026-05-26"; got != want {
		t.Fatalf("interpolateTemplate = %q, want %q", got, want)
	}
}

func TestInterpolateTemplate_UsesTriggerTimezoneForDate(t *testing.T) {
	s := &AutopilotService{}
	ap := db.Autopilot{
		Title:              "fallback",
		IssueTitleTemplate: pgtype.Text{String: "Tokyo report {{date}}", Valid: true},
	}
	run := db.AutopilotRun{
		TriggeredAt: pgtype.Timestamptz{Time: time.Date(2026, 5, 26, 23, 30, 0, 0, time.UTC), Valid: true},
	}

	got := s.interpolateTemplate(ap, run, "Asia/Tokyo")
	if want := "Tokyo report 2026-05-27"; got != want {
		t.Fatalf("interpolateTemplate = %q, want %q", got, want)
	}
}
