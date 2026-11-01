package execenv

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

// snippetBlock returns the indented command block of a rendered reply
// cookbook that contains marker — the lines an agent actually pastes into one
// shell call. The Windows cookbook carries one block per shell (PowerShell and
// Git Bash, #8627), so a caller names the block by a token unique to it.
func snippetBlock(t *testing.T, rendered, marker string) []string {
	t.Helper()
	var block []string
	flush := func() []string {
		for _, line := range block {
			if strings.Contains(line, marker) {
				return block
			}
		}
		return nil
	}
	for _, line := range strings.Split(rendered, "\n") {
		if strings.HasPrefix(line, "    ") && strings.TrimSpace(line) != "" {
			block = append(block, strings.TrimSpace(line))
			continue
		}
		if found := flush(); found != nil {
			return found
		}
		block = nil
	}
	if found := flush(); found != nil {
		return found
	}
	t.Fatalf("reply instructions contain no command block with %q\n---\n%s", marker, rendered)
	return nil
}

// stubAuro puts a fake `auro` on PATH that exits with the given code, so
// the snippet's failure handling can be exercised without the real CLI (and
// without any network or agent binary — see the default-test rule in
// CLAUDE.md). Returns the directory to prepend to PATH.
//
// The stub's form follows the HOST, not the snippet variant being rendered:
// PowerShell is cross-platform, so the Windows cookbook is exercised on a
// Linux runner too, and there a `.cmd` shim would never resolve.
func stubAuro(t *testing.T, exitCode int) string {
	t.Helper()
	dir := t.TempDir()
	name, body := "auro", "#!/bin/sh\nexit "+strconv.Itoa(exitCode)+"\n"
	if runtime.GOOS == "windows" {
		name, body = "auro.cmd", "@exit /b "+strconv.Itoa(exitCode)+"\r\n"
	}
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}
	return dir
}

// runSnippet executes the snippet in a scratch workdir seeded with reply.md
// and reports the invocation's exit code plus whether reply.md survived.
func runSnippet(t *testing.T, shell string, args []string, stubDir string) (int, bool) {
	t.Helper()
	work := t.TempDir()
	body := filepath.Join(work, "reply.md")
	if err := os.WriteFile(body, []byte("final result"), 0o600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(shell, args...)
	cmd.Dir = work
	cmd.Env = append(os.Environ(), "PATH="+stubDir+string(os.PathListSeparator)+os.Getenv("PATH"))
	err := cmd.Run()
	code := 0
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code = exitErr.ExitCode()
	} else if err != nil {
		t.Fatalf("run snippet: %v", err)
	}
	_, statErr := os.Stat(body)
	return code, statErr == nil
}
