package ctf

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

func TestComputePreservesPresentationEvents(t *testing.T) {
	path := os.Getenv("CTF_ENGINE_PATH")
	if path == "" {
		t.Skip("CTF_ENGINE_PATH not set")
	}
	var out Outcome
	engine := &NodeEngine{Path: path}
	if err := engine.Call(context.Background(), "run", map[string]any{"seed": 12027, "red": example(t, "ZS01"), "blue": example(t, "ZS02")}, &out); err != nil {
		t.Fatal(err)
	}
	if out.Result == nil || out.Result.Winner != "red" {
		t.Fatal("fixed fixture lost its authoritative result")
	}
	events := map[string]bool{}
	for _, raw := range out.Frames {
		var frame struct {
			Events []struct {
				ID   string `json:"id"`
				Kind string `json:"kind"`
			} `json:"events"`
		}
		if err := json.Unmarshal(raw, &frame); err != nil {
			t.Fatal(err)
		}
		if frame.Events == nil {
			t.Fatal("compute transport omitted the presentation event contract")
		}
		for _, event := range frame.Events {
			if event.Kind == "attack" {
				events[event.ID] = true
			}
		}
	}
	if len(events) != 85 {
		t.Fatalf("recording has %d unique attacks, want 85", len(events))
	}
}
