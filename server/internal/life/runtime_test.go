package life

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func stubRuntime(t *testing.T, body string) *NodeRuntime {
	t.Helper()
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("Node is not installed")
	}
	script := filepath.Join(t.TempDir(), "engine.mjs")
	code := `import {createInterface} from 'node:readline';
for await(const line of createInterface({input:process.stdin})){const q=JSON.parse(line);` + body + `}`
	if err := os.WriteFile(script, []byte(code), 0600); err != nil {
		t.Fatal(err)
	}
	runtime := NewNodeRuntime(script)
	t.Cleanup(func() { _ = runtime.Close() })
	return runtime
}

func TestRuntimeUsesOneProcessAndStripsCredentials(t *testing.T) {
	t.Setenv("DATABASE_URL", "must-not-reach-compute")
	t.Setenv("AURO_TOKEN", "must-not-reach-compute")
	t.Setenv("NODE_OPTIONS", "--this-option-must-not-reach-compute")
	runtime := stubRuntime(t, `process.stdout.write(JSON.stringify({version:3,requestId:q.requestId,result:{pid:process.pid,secret:!!(process.env.DATABASE_URL||process.env.AURO_TOKEN||process.env.NODE_OPTIONS)}})+'\n');`)
	var first, second struct {
		PID    int  `json:"pid"`
		Secret bool `json:"secret"`
	}
	if err := runtime.call(context.Background(), "seed", nil, &first); err != nil {
		t.Fatal(err)
	}
	if err := runtime.call(context.Background(), "seed", nil, &second); err != nil {
		t.Fatal(err)
	}
	if first.PID <= 0 || first.PID != second.PID || first.Secret || second.Secret {
		t.Fatalf("runtime leaked environment or restarted: %+v %+v", first, second)
	}
	_ = runtime.Close()
	if err := runtime.call(context.Background(), "seed", nil, &second); err == nil {
		t.Fatal("closed runtime restarted")
	}
}

func TestRuntimeRejectsBrokenFramesAndReapsTimedOutChild(t *testing.T) {
	for _, tc := range []struct{ name, body string }{
		{"identity", `process.stdout.write(JSON.stringify({version:3,requestId:'other',result:{}})+'\n');`},
		{"version", `process.stdout.write(JSON.stringify({version:99,requestId:q.requestId,result:{}})+'\n');`},
		{"malformed", `process.stdout.write('not-json\n');`},
		{"oversized", `process.stdout.write('x'.repeat(4*1024*1024+1)+'\n');`},
		{"exited", `process.exit(1);`},
		{"timeout", `await new Promise(()=>{});`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runtime := stubRuntime(t, tc.body)
			runtime.Timeout = 400 * time.Millisecond
			var value map[string]any
			started := time.Now()
			if err := runtime.call(context.Background(), "seed", nil, &value); err == nil {
				t.Fatal("accepted invalid engine response")
			}
			if runtime.process != nil {
				t.Fatal("broken child not reaped")
			}
			if time.Since(started) > 3*time.Second {
				t.Fatal("runtime cancellation exceeded its deadline")
			}
		})
	}
}

func TestRuntimeRestartsAfterChildExit(t *testing.T) {
	marker, _ := json.Marshal(filepath.Join(t.TempDir(), "started"))
	runtime := stubRuntime(t, `const fs=await import('node:fs');if(!fs.existsSync(`+string(marker)+`)){fs.writeFileSync(`+string(marker)+`,'1');process.exit(1);}process.stdout.write(JSON.stringify({version:3,requestId:q.requestId,result:{ok:true}})+'\n');`)
	var value struct {
		OK bool `json:"ok"`
	}
	if err := runtime.call(context.Background(), "seed", nil, &value); err == nil {
		t.Fatal("expected exited child")
	}
	if err := runtime.call(context.Background(), "seed", nil, &value); err != nil || !value.OK {
		t.Fatalf("restart: %v %+v", err, value)
	}
}

func TestContractRejectsChangedIdentityAndMissingTerminalEvent(t *testing.T) {
	id := "a11fe000-0000-4000-8000-000000000001"
	before := Simulation{Agents: []Resident{{ID: id, Name: "Resident", Goal: Goal{Kind: "wood", Target: 12}}}, Resources: []Resource{{"forest", "wood", 400}, {"farm", "food", 400}, {id, "food", 4}, {id, "wood", 0}, {id, "coins", 0}}, Actions: []Action{}}
	action := Action{ID: "b11fe000-0000-4000-8000-000000000001", AgentID: id, Intent: Intent{Kind: "REST"}, Reason: "recover", StartedTick: 1, DueTick: 4, Status: "running"}
	valid := TickResult{State: Simulation{Tick: 1, Agents: before.Agents, Resources: before.Resources, Actions: []Action{action}}, Started: []Action{action}, Completed: []Action{}, Events: []EngineEvent{}}
	if err := validateResult(before, valid); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		change func(*TickResult)
	}{
		{"clock", func(r *TickResult) { r.State.Tick = 2 }},
		{"resident", func(r *TickResult) { r.State.Agents[0].Name = "replaced" }},
		{"negative", func(r *TickResult) { r.State.Resources[0].Amount = -1 }},
		{"invented inventory", func(r *TickResult) { r.State.Resources[0].Owner = "other" }},
		{"action projection", func(r *TickResult) { r.Started = nil }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, _ := json.Marshal(valid)
			var bad TickResult
			_ = json.Unmarshal(raw, &bad)
			tc.change(&bad)
			if err := validateResult(before, bad); err == nil {
				t.Fatal("accepted invalid transition")
			}
		})
	}
	before = valid.State
	before.Tick = 4
	terminal := action
	terminal.Status = "completed"
	next := action
	next.ID = "c11fe000-0000-4000-8000-000000000001"
	next.StartedTick = 5
	next.DueTick = 8
	result := TickResult{State: Simulation{Tick: 5, Agents: before.Agents, Resources: before.Resources, Actions: []Action{next}}, Completed: []Action{terminal}, Started: []Action{next}}
	if err := validateResult(before, result); err == nil || !strings.Contains(err.Error(), "missing terminal") {
		t.Fatalf("accepted untraced action: %v", err)
	}
}
