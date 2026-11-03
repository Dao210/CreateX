package main

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/spf13/cobra"

	"github.com/auro-ai/auro/server/internal/util"
)

// resolveTextFlag picks between a `--<name>` inline value, a `--<name>-stdin`
// flag, and a `--<name>-file <path>` flag, mirroring the existing `--content`
// / `--content-stdin` pattern. It returns the resolved string and an error
// when more than one source is set, or when stdin/file is requested but
// produces no body. Inline flag values are passed through
// util.UnescapeBackslashEscapes so bash-double-quoted `\n` becomes a real
// newline; stdin and file bodies are returned verbatim so literal backslashes
// survive intact.
//
// The `-file` source exists for Windows agents: piping HEREDOC content to
// `--<name>-stdin` from Windows PowerShell silently drops non-ASCII bytes
// (PowerShell 5.1's `$OutputEncoding` defaults to ASCIIEncoding when piping
// to a native command), so Chinese / Cyrillic / any non-ASCII content
// arrives as `?`. Reading a UTF-8 file directly bypasses the shell's pipe
// re-encoding entirely. See issues #2198 / #2236 / #2376.
func resolveTextFlag(cmd *cobra.Command, flagName string) (string, bool, error) {
	stdinFlag := flagName + "-stdin"
	fileFlag := flagName + "-file"
	useStdin, _ := cmd.Flags().GetBool(stdinFlag)
	inline, _ := cmd.Flags().GetString(flagName)
	filePath, _ := cmd.Flags().GetString(fileFlag)

	sources := 0
	if useStdin {
		sources++
	}
	if inline != "" {
		sources++
	}
	if filePath != "" {
		sources++
	}
	if sources > 1 {
		return "", false, fmt.Errorf("--%s, --%s, and --%s are mutually exclusive", flagName, stdinFlag, fileFlag)
	}

	if useStdin {
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return "", false, fmt.Errorf("read stdin for --%s: %w", stdinFlag, err)
		}
		body := strings.TrimSuffix(string(data), "\n")
		if body == "" {
			return "", false, fmt.Errorf("stdin content for --%s is empty", stdinFlag)
		}
		return body, true, nil
	}
	if filePath != "" {
		if err := ensureFileFlagWithinWorkdir(cmd, fileFlag, flagName, filePath); err != nil {
			return "", false, err
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			return "", false, fmt.Errorf("read file for --%s: %w", fileFlag, err)
		}
		body := strings.TrimSuffix(string(data), "\n")
		if body == "" {
			return "", false, fmt.Errorf("file content for --%s is empty", fileFlag)
		}
		return body, true, nil
	}
	if inline == "" {
		return "", false, nil
	}
	return util.UnescapeBackslashEscapes(inline), true, nil
}

// ensureFileFlagWithinWorkdir fails closed when a --<name>-file path resolves
// outside the current working directory, unless --allow-external-file is set.
//
// Agent task workdirs are isolated per profile and per task; machine-shared
// scratch paths like /tmp are not. MUL-4252 traced a cross-environment context
// leak to exactly this gap: a quick-create run wrote its description to a fixed
// /tmp/desc.md, the write silently failed because a *different* environment's
// run had left a stale file there minutes earlier, and --description-file then
// fed that stale content into the new issue. Requiring the file to live under
// the workdir turns "silently read another run's file" into a loud command
// failure — an "incorrect content" bug becomes a "command errored" bug.
func ensureFileFlagWithinWorkdir(cmd *cobra.Command, fileFlag, flagName, filePath string) error {
	if allow, _ := cmd.Flags().GetBool("allow-external-file"); allow {
		return nil
	}
	within, err := fileWithinWorkingDir(filePath)
	if err != nil {
		return fmt.Errorf("resolve --%s path %q: %w", fileFlag, filePath, err)
	}
	if !within {
		if !pathExists(filePath) {
			return fmt.Errorf(
				"--%s path %q does not exist; it also resolves outside the current working directory, "+
					"so --allow-external-file would not make this read succeed. Write the file inside the "+
					"task workdir (e.g. ./%s.md) and pass that path.",
				fileFlag, filePath, flagName)
		}
		return fmt.Errorf(
			"--%s path %q resolves outside the current working directory; "+
				"write agent temp files inside the run workdir (e.g. ./%s.md) rather than machine-shared "+
				"paths like /tmp, where another run's stale file can be read by mistake. "+
				"Pass --allow-external-file to override.",
			fileFlag, filePath, flagName)
	}
	return nil
}

// pathExists reports whether filePath names something on disk. It exists to
// separate the two facts the containment guard used to merge: a rejected path
// that is ALSO missing has no stale file behind it for anyone to read by
// mistake, so leading with --allow-external-file sends the caller to disable
// the guard and hit an unrelated not-found error on the retry. Any stat error
// other than "not exists" (a permission wall, a broken mount) is treated as
// "exists" so the guard keeps its own wording and stays fail-closed.
func pathExists(filePath string) bool {
	_, err := os.Stat(filePath)
	return !errors.Is(err, os.ErrNotExist)
}

// fileWithinWorkingDir reports whether filePath resolves to a location inside
// the process working directory. Both sides are canonicalized the same way, so
// aliased roots (e.g. macOS /tmp -> /private/tmp), symlinks planted inside the
// workdir, and directory junctions pointing out of it all fail closed. A path
// that does not exist yet is resolved as far as it exists, so the caller's
// os.ReadFile still surfaces the real not-found error afterwards.
//
// Windows relative paths are handed over for what they are, not for what they
// look like: `\tmp\desc.md` resolves against the workdir's volume ROOT and
// `C:tmp\desc.md` against the current directory on C:, so prefixing the
// workdir onto either would judge a shadow file while os.ReadFile opens the
// real one. util.ResolveSymlinksBestEffort preserves those kinds, for link
// targets as well as for the input itself.
func fileWithinWorkingDir(filePath string) (bool, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return false, err
	}
	base, err := util.ResolveSymlinksBestEffort(cwd)
	if err != nil {
		// The workdir's own resolution cannot be determined (an unobservable
		// drive, a reparse point no query can name). Comparing a candidate
		// against a root that cannot be named judges whatever string the
		// resolver would have guessed, so fail closed.
		return false, nil
	}
	// Canonicalize the candidate exactly the way the base was, and hand it over
	// as typed: util.ResolveSymlinksBestEffort makes it absolute itself, because
	// pre-joining it here would clean the string first and collapse a ".."
	// across a symlink — judging a different path than the one os.ReadFile then
	// opens.
	//
	// os.Getwd() returns the LOGICAL working directory when $PWD names it (a
	// shell's `cd`, and the PWD the daemon exports to agent processes, both
	// carry unresolved symlinks), so the two sides only agree once both are
	// resolved. Resolving best-effort is what makes that possible for a
	// candidate that does not exist yet — a typo, or an artifact a build step
	// never produced — and every cheaper approximation gets one direction wrong:
	//
	//   - Leaving the candidate unresolved (filepath.Clean) reads a path inside
	//     the workdir as outside it, which reports a missing file as a
	//     guardrail violation and points the caller at --allow-external-file
	//     instead of at the real error.
	//   - Resolving only one level up (filepath.Dir) still breaks once an
	//     intermediate directory is missing, and worse: with an already-
	//     canonical cwd it reads `escape/sub/x.md` — under a symlink pointing
	//     out of the workdir — as INSIDE it, because the unresolvable tail
	//     falls back to a lexical clean that never sees the symlink.
	abs, err := util.ResolveSymlinksBestEffort(filePath)
	if err != nil {
		// ErrUnresolvablePath: the kernel may open this path somewhere this
		// process cannot name — a reparse point that redirects but survives
		// both os.Readlink and a handle query, or a drive-relative path on a
		// drive whose current directory is unobservable. The string the input
		// spells is not evidence of where the kernel would read, so fail
		// closed; the caller's own os.ReadFile would surface a plain error
		// for the same path.
		return false, nil
	}
	rel, err := filepath.Rel(base, abs)
	if err != nil {
		// Two absolute paths that filepath.Rel cannot relate are on different
		// volumes, which is as far outside the workdir as a path can get. Only
		// Windows produces this: with a workdir on C:, `--content-file
		// Z:\report.md` used to surface `Rel: can't make Z:\report.md relative
		// to C:\...` as an internal resolve failure instead of the guardrail's
		// own explanation — the same misleading-diagnosis shape this guard is
		// being fixed for. Measured on 10.0.19045 / go1.26.6. There is no Unix
		// input that reaches this branch, so the windows-tagged test in this
		// package is the only thing that covers it.
		return false, nil
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return false, nil
	}
	return true, nil
}

func isHTTPURL(path string) bool {
	p := strings.TrimSpace(path)
	return strings.HasPrefix(p, "http://") || strings.HasPrefix(p, "https://")
}

// ensureAttachmentWithinWorkdir applies the same workdir containment guard as
// --description-file / --content-file (MUL-4252) to a local --attachment path.
// An agent that writes a chart/report to a machine-shared path like /tmp and
// then attaches it could otherwise pick up another run's — possibly another
// workspace's — stale file (the image version of the /tmp/desc.md leak). URL
// values are filtered by the caller and never reach here. --allow-external-file
// overrides, mirroring the text-flag escape hatch.

func truncateID(id string) string {
	if utf8.RuneCountInString(id) > 8 {
		runes := []rune(id)
		return string(runes[:8])
	}
	return id
}
