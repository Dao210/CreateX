package life

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/google/uuid"
)

type Engine interface {
	Seed(context.Context) (Seed, error)
	Advance(context.Context, Simulation) (TickResult, error)
	Close() error
}

type NodeRuntime struct {
	NodePath, ScriptPath string
	Timeout              time.Duration
	gate                 chan struct{}
	process              *engineProcess
	closed               bool
}
type engineProcess struct {
	cmd    *exec.Cmd
	input  io.WriteCloser
	output *bufio.Scanner
	done   chan error
}
type engineResponse struct {
	Version   int             `json:"version"`
	RequestID string          `json:"requestId"`
	Result    json.RawMessage `json:"result"`
	Error     string          `json:"error,omitempty"`
}

func NewNodeRuntime(script string) *NodeRuntime {
	return &NodeRuntime{NodePath: "node", ScriptPath: script, Timeout: 5 * time.Second, gate: make(chan struct{}, 1)}
}
func DefaultEnginePath() string {
	executable, err := os.Executable()
	if err != nil {
		return ""
	}
	// Resolve a release symlink now so a web-only activation cannot change a running engine's version.
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	return filepath.Join(filepath.Dir(executable), "runtime", "life", "engine.mjs")
}
func (r *NodeRuntime) start() error {
	script, err := filepath.Abs(r.ScriptPath)
	if err != nil {
		return err
	}
	if _, err = os.Stat(script); err != nil {
		return fmt.Errorf("life engine bundle: %w", err)
	}
	node, err := exec.LookPath(r.NodePath)
	if err != nil {
		return fmt.Errorf("life node runtime: %w", err)
	}
	cmd := exec.Command(node, script)
	// Compute hosts receive neither DATABASE_URL nor model/account credentials.
	for _, key := range []string{"PATH", "SYSTEMROOT", "TMPDIR", "TEMP"} {
		if value, ok := os.LookupEnv(key); ok {
			cmd.Env = append(cmd.Env, key+"="+value)
		}
	}
	if cmd.Env == nil {
		cmd.Env = []string{}
	}
	cmd.Stderr = io.Discard
	input, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return err
	}
	if err = cmd.Start(); err != nil {
		input.Close()
		output.Close()
		return err
	}
	scanner := bufio.NewScanner(output)
	scanner.Buffer(make([]byte, 64*1024), maxFrame)
	process := &engineProcess{cmd: cmd, input: input, output: scanner, done: make(chan error, 1)}
	go func() { process.done <- cmd.Wait() }()
	r.process = process
	return nil
}
func (r *NodeRuntime) stop() {
	if p := r.process; p != nil {
		_ = p.input.Close()
		_ = p.cmd.Process.Kill()
		<-p.done
		r.process = nil
	}
}
func (r *NodeRuntime) call(ctx context.Context, operation string, state *Simulation, out any) error {
	timeout := r.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	select {
	case r.gate <- struct{}{}:
		defer func() { <-r.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}
	if r.closed {
		return errors.New("life runtime is closed")
	}
	if r.process == nil {
		if err := r.start(); err != nil {
			return err
		}
	}
	requestID := uuid.NewString()
	request := struct {
		Version   int         `json:"version"`
		RequestID string      `json:"requestId"`
		Operation string      `json:"operation"`
		State     *Simulation `json:"state,omitempty"`
	}{protocolVersion, requestID, operation, state}
	raw, err := json.Marshal(request)
	if err != nil {
		return err
	}
	if len(raw) > maxFrame {
		return errors.New("life request exceeds frame limit")
	}
	p := r.process
	reply := make(chan error, 1)
	var response []byte
	go func() {
		if _, err := p.input.Write(append(raw, '\n')); err != nil {
			reply <- err
			return
		}
		if !p.output.Scan() {
			err := p.output.Err()
			if err == nil {
				err = io.ErrUnexpectedEOF
			}
			reply <- err
			return
		}
		response = append([]byte(nil), p.output.Bytes()...)
		reply <- nil
	}()
	select {
	case err = <-reply:
	case <-ctx.Done():
		r.stop()
		<-reply
		return ctx.Err()
	}
	if err != nil {
		r.stop()
		return fmt.Errorf("life engine transport: %w", err)
	}
	var envelope engineResponse
	if err = strictJSON(response, &envelope); err != nil || envelope.Version != protocolVersion || envelope.RequestID != requestID || envelope.Error != "" || len(envelope.Result) == 0 {
		r.stop()
		return errors.New("invalid life engine response")
	}
	if err = strictJSON(envelope.Result, out); err != nil {
		r.stop()
		return fmt.Errorf("invalid life engine result: %w", err)
	}
	return nil
}
func (r *NodeRuntime) Seed(ctx context.Context) (Seed, error) {
	var seed Seed
	err := r.call(ctx, "seed", nil, &seed)
	if err == nil {
		if len(seed.Agents) != 20 || seed.TickMS < 100 || seed.TickMS > 60000 {
			err = errors.New("invalid seed")
		}
		if err == nil {
			err = validateState(Simulation{Agents: seed.Agents, Resources: seed.Resources, Actions: []Action{}})
		}
	}
	return seed, err
}
func (r *NodeRuntime) Advance(ctx context.Context, state Simulation) (TickResult, error) {
	var result TickResult
	if err := validateState(state); err != nil {
		return result, err
	}
	if err := r.call(ctx, "tick", &state, &result); err != nil {
		return result, err
	}
	return result, validateResult(state, result)
}
func (r *NodeRuntime) Close() error {
	r.gate <- struct{}{}
	defer func() { <-r.gate }()
	r.closed = true
	r.stop()
	return nil
}
