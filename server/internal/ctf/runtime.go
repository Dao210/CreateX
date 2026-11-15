package ctf

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/google/uuid"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

type Engine interface {
	Call(context.Context, string, map[string]any, any) error
	Run(context.Context, map[string]any, any, func(json.RawMessage) error) error
}
type NodeEngine struct{ Path string }

func DefaultEnginePath() string {
	if p := os.Getenv("CTF_ENGINE_PATH"); p != "" {
		return p
	}
	p, _ := os.Executable()
	if resolved, e := filepath.EvalSymlinks(p); e == nil {
		p = resolved
	}
	return filepath.Join(filepath.Dir(p), "runtime", "ctf", "engine.mjs")
}

func (n *NodeEngine) Call(ctx context.Context, op string, input map[string]any, out any) error {
	return n.call(ctx, op, input, out, nil)
}
func (n *NodeEngine) Run(ctx context.Context, input map[string]any, out any, progress func(json.RawMessage) error) error {
	return n.call(ctx, "run", input, out, progress)
}
func (n *NodeEngine) call(ctx context.Context, op string, input map[string]any, out any, progress func(json.RawMessage) error) error {
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	request := make(map[string]any, len(input)+3)
	for k, v := range input {
		request[k] = v
	}
	id := uuid.NewString()
	request["version"] = 1
	request["requestId"] = id
	request["operation"] = op
	request["progress"] = progress != nil
	raw, e := json.Marshal(request)
	if e != nil {
		return e
	}
	if len(raw) > 4*1024*1024 {
		return errors.New("compute_input_limit")
	}
	cmd := exec.CommandContext(ctx, "node", n.Path)
	for _, key := range []string{"PATH", "SYSTEMROOT", "TMPDIR", "TEMP"} {
		if v, ok := os.LookupEnv(key); ok {
			cmd.Env = append(cmd.Env, key+"="+v)
		}
	}
	if cmd.Env == nil {
		cmd.Env = []string{}
	}
	cmd.Stdin = bytes.NewReader(append(raw, '\n'))

	cmd.Stderr = io.Discard
	pipe, e := cmd.StdoutPipe()
	if e != nil {
		return e
	}
	if e = cmd.Start(); e != nil {
		return e
	}
	done := false
	defer func() {
		if !done {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	}()
	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, 64*1024), 12*1024*1024)
	var final json.RawMessage
	for scanner.Scan() {
		var response struct {
			Version   int             `json:"version"`
			RequestID string          `json:"requestId"`
			Result    json.RawMessage `json:"result"`
			Progress  json.RawMessage `json:"progress"`
			Error     string          `json:"error"`
		}
		if e = json.Unmarshal(scanner.Bytes(), &response); e != nil {
			return e
		}
		if response.Version != 1 || response.RequestID != id || response.Error != "" {
			return errors.New("invalid_compute_response")
		}
		if len(response.Progress) > 0 {
			if progress == nil {
				return errors.New("unexpected_compute_progress")
			}
			if e = progress(response.Progress); e != nil {
				return e
			}
		} else {
			if len(final) > 0 {
				return errors.New("duplicate_compute_response")
			}
			final = append([]byte(nil), response.Result...)
		}
	}
	if e = scanner.Err(); e != nil {
		return e
	}
	e = cmd.Wait()
	done = true
	if e != nil {
		return e
	}
	if len(final) == 0 {
		return errors.New("missing_compute_response")
	}
	return json.Unmarshal(final, out)
}
