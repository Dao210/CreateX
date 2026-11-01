package main

import (
	"io"
	"os"
	"strings"
	"testing"
)

type stderrCapture struct {
	t       *testing.T
	orig    *os.File
	r, w    *os.File
	out     strings.Builder
	doneCh  chan struct{}
	stopped bool
}

func captureStderr(t *testing.T) *stderrCapture {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	c := &stderrCapture{t: t, orig: os.Stderr, r: r, w: w, doneCh: make(chan struct{})}
	os.Stderr = w
	go func() {
		buf, _ := io.ReadAll(r)
		c.out.Write(buf)
		close(c.doneCh)
	}()
	return c
}

func (c *stderrCapture) restore() {
	if c.stopped {
		return
	}
	c.stopped = true
	os.Stderr = c.orig
	_ = c.w.Close()
	<-c.doneCh
	_ = c.r.Close()
}

func (c *stderrCapture) read() string {
	c.restore()
	return c.out.String()
}

// pipeStdin replaces os.Stdin with a pipe seeded by the given body for the
// duration of fn, so resolveTextFlag's --content-stdin / --description-stdin
// branch can be exercised in unit tests without spawning a subprocess.
func pipeStdin(t *testing.T, body string, fn func()) {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("pipe: %v", err)
	}
	if _, err := w.WriteString(body); err != nil {
		t.Fatalf("write pipe: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close pipe writer: %v", err)
	}
	orig := os.Stdin
	os.Stdin = r
	defer func() {
		os.Stdin = orig
		_ = r.Close()
	}()
	fn()
}
