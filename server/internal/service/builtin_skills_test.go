package service

import (
	"regexp"
	"strings"
	"testing"

	"github.com/auro-ai/auro/server/internal/util"
	"gopkg.in/yaml.v3"
)

// Built-in skills are the platform's standard "template" skills. These evals
// pin the template every skill must follow and — crucially — couple each
// skill's documented contract to the real backend behavior it describes, so a
// drift in the source-of-truth (e.g. the mention regex) breaks CI instead of
// silently turning the skill into a lie agents act on.
//
// The evals live in a _test.go file on purpose: anything *inside* a skill
// directory is walked into AgentSkillData.Files and shipped to agent machines
// (see loadBuiltinSkill). Tests must stay out of that payload.
//
// The same reasoning is what TestBuiltinSkillPayloadCarriesNoSourceReferences
// enforces for the payload's CONTENT (MUL-6986). A shipped skill is read on a
// machine that has no copy of this repository, so a file:line citation, a Go
// identifier, or a `go test` command in it is not merely useless — it sends the
// reader grepping for paths that do not exist. Evidence about how the server
// implements a contract belongs here, next to the assertion that pins it.

const (
	// maxSkillBodyLines is Anthropic's L2 budget for a SKILL.md body
	// (~5k tokens). Past this, content belongs in one-level-deep supporting
	// files, not the always-loaded body.
	maxSkillBodyLines = 500
	// maxRoutingBodyLines applies to a skill that HAS supporting references.
	// Its body is then a router — positioning, shared invariants, and a table
	// naming the reference to open — and every line it spends restating a
	// reference is a line every activation pays for. The whole point of
	// splitting into references is that the body stays cheap.
	maxRoutingBodyLines = 150
	// maxDescriptionChars is the frontmatter description cap — it is the only
	// thing an agent sees when deciding whether to load the skill, and every
	// runtime CLI pays for it in the always-loaded skill listing. A description
	// earns its characters two ways only: trigger wording that matches how the
	// task actually arrives, and reverse boundaries that prevent mis-routing.
	//
	// Naming several domains is not the "content inventory" this rules out. The
	// ban is on restating the BODY's section headings, which the agent reads for
	// free once it opens the skill. Nouns like "squad" or "autopilot" are how
	// the task arrives — they are trigger wording, and after MUL-6986 one
	// description has to do the recall work eight used to.
	maxDescriptionChars = 300
)

// TestBuiltinSkillsConformToTemplate enforces the standard-template invariants
// on every built-in skill, current and future. A new skill that violates the
// shape fails here without anyone having to remember the rules.
func TestBuiltinSkillsConformToTemplate(t *testing.T) {
	skills := allBuiltinSkillsForTest()
	if len(skills) == 0 {
		t.Fatal("no built-in skills loaded; embed or layout is broken")
	}

	for _, skill := range skills {
		t.Run(skill.Name, func(t *testing.T) {
			// The auro- prefix is the platform namespace. Pointers name
			// built-ins by their bare name on the assumption that no
			// workspace skill shares one; nothing reserves the prefix
			// server-side yet, and that gap is accepted rather than handled
			// (see builtinSlug).
			if !strings.HasPrefix(skill.Name, "auro-") {
				t.Errorf("skill name %q must carry the auro- prefix", skill.Name)
			}

			fm, body, ok := splitFrontmatter(skill.Content)
			if !ok {
				t.Fatalf("SKILL.md must lead with a --- frontmatter block")
			}
			if strings.TrimSpace(fm["name"]) == "" {
				t.Errorf("frontmatter is missing a non-empty name")
			}
			desc := strings.TrimSpace(fm["description"])
			if desc == "" {
				t.Errorf("frontmatter is missing a description (the only thing an agent sees when deciding to load the skill)")
			}
			if len(desc) > maxDescriptionChars {
				t.Errorf("description is %d chars, over the %d cap", len(desc), maxDescriptionChars)
			}
			budget := maxSkillBodyLines
			if len(skill.Files) > 0 {
				// A skill with references has already paid for the split; its
				// body must stay a router.
				budget = maxRoutingBodyLines
			}
			if n := strings.Count(body, "\n") + 1; n > budget {
				t.Errorf("SKILL.md body is %d lines, over the %d-line budget; move detail into one-level-deep supporting files", n, budget)
			}

			// Every built-in is a platform-contract skill: it triggers from
			// context rather than a slash command, and it is fenced to the CLI
			// it teaches.
			if got := strings.TrimSpace(fm["user-invocable"]); got != "false" {
				t.Errorf("user-invocable = %q, want false (a platform-contract skill triggers from context, not a slash command)", got)
			}
			// allowed-tools is the union across everything the skill now covers.
			// Merging eight skills merged their tool declarations too, so the
			// router declares Bash(git *) / Bash(gh *) — which only issues.md
			// needs — while an agent is reading, say, autopilots.md. The
			// alternative is dropping them and regressing the issue workflow
			// that legitimately runs `gh pr`. Recorded rather than silently
			// widened: allowed-tools is a pre-approval list, and today the
			// daemon's global permission mode means this grants no privilege
			// the agent did not already have. Revisit if per-reference
			// declarations ever exist.
			if got := strings.TrimSpace(fm["allowed-tools"]); !strings.Contains(got, "Bash(auro *)") {
				t.Errorf("allowed-tools = %q, want access to the Auro CLI", got)
			}

			for _, f := range skill.Files {
				if n := strings.Count(f.Content, "\n") + 1; n > maxSkillBodyLines {
					t.Errorf("supporting file %q is %d lines, over the %d-line budget; split it", f.Path, n, maxSkillBodyLines)
				}
			}

			// Evals must never ride along to agent machines as supporting files.
			for _, f := range skill.Files {
				lower := strings.ToLower(f.Path)
				if strings.Contains(lower, "eval") || strings.HasSuffix(lower, "_test.go") || strings.HasSuffix(lower, "_test.md") {
					t.Errorf("supporting file %q looks like an eval/test; evals belong in _test.go, not the shipped skill payload", f.Path)
				}
			}
		})
	}
}

// TestBuiltinSkillsFrontmatterIsStrictYAML is the regression guard for MUL-3100
// / GitHub #3851: a built-in SKILL.md whose frontmatter is not valid YAML 1.2
// (the canonical break is an unquoted `: ` inside the description) is silently
// dropped by strict runtimes like Codex, so the agent runs without that
// platform-contract skill.
//
// This check is deliberately separate from TestBuiltinSkillsConformToTemplate:
// that test reads the frontmatter through splitFrontmatter, a naive line parser
// that splits on the first ':' and never runs a YAML parse — so it passes even
// on the broken files. Only a real yaml.Unmarshal reproduces what Codex does,
// which is exactly what is needed to catch this class of bug before it ships.
func TestBuiltinSkillsFrontmatterIsStrictYAML(t *testing.T) {
	skills := allBuiltinSkillsForTest()
	if len(skills) == 0 {
		t.Fatal("no built-in skills loaded; embed or layout is broken")
	}

	for _, skill := range skills {
		t.Run(skill.Name, func(t *testing.T) {
			content := skill.Content
			if !strings.HasPrefix(content, "---\n") {
				t.Fatalf("SKILL.md must lead with a --- frontmatter block")
			}
			rest := content[len("---\n"):]
			end := strings.Index(rest, "\n---")
			if end < 0 {
				t.Fatalf("frontmatter has no closing --- delimiter")
			}

			var fm map[string]any
			if err := yaml.Unmarshal([]byte(rest[:end]), &fm); err != nil {
				t.Fatalf("frontmatter is not valid YAML — a strict runtime (e.g. Codex) "+
					"will drop this skill on load; quote values containing ': ': %v", err)
			}

			if name, ok := fm["name"].(string); !ok || strings.TrimSpace(name) == "" {
				t.Errorf("frontmatter name must parse as a non-empty string, got %#v", fm["name"])
			}
			if desc, ok := fm["description"].(string); !ok || strings.TrimSpace(desc) == "" {
				t.Errorf("frontmatter description must parse as a non-empty string, got %#v", fm["description"])
			}
		})
	}
}

// TestBuiltinSkillPayloadCarriesNoSourceReferences is the regression guard for
// MUL-6986: the shipped payload must not reference this repository's source.
//
// Every file in a skill directory is written into the workdir of every task
// that receives the skill — on the user's own machine, which has no checkout of
// this repo. A `file:line` citation there resolves to nothing, and a `go test`
// or `grep -n ... internal/handler/x.go` "verification command" actively sends
// the reading agent after paths that cannot exist. Before this test, roughly
// half the built-in payload by bytes was exactly that.
//
// Maintainer-facing evidence for a contract belongs in this file, beside the
// assertion that pins it, where it stays with the code it describes.
func TestBuiltinSkillPayloadCarriesNoSourceReferences(t *testing.T) {
	banned := []struct {
		what string
		re   *regexp.Regexp
	}{
		{"a path into this repository", regexp.MustCompile(`(?:server|packages|apps|e2e)/[A-Za-z0-9_-]+/`)},
		{"a source file name", regexp.MustCompile(`[A-Za-z0-9_./-]*\.(?:go|ts|tsx|sql)\b`)},
		{"a command that only runs in this repository", regexp.MustCompile(`\bgo (?:test|build|vet|run)\b`)},
		{"a migration ordinal", regexp.MustCompile(`\bmigrations?/[0-9]`)},
		{"a Go package-qualified identifier", regexp.MustCompile(`\b(?:util|service|handler|db|protocol|skillpkg|repocache|execenv|daemon)\.[A-Z][A-Za-z0-9]*`)},
		{"a Go test name", regexp.MustCompile(`\bTest[A-Z][A-Za-z0-9]{3,}\b`)},
		{"a development branch name", regexp.MustCompile(`\b(?:feat|fix|refactor|chore)/[a-z0-9][a-z0-9-]*`)},
	}

	for _, skill := range allBuiltinSkillsForTest() {
		t.Run(skill.Name, func(t *testing.T) {
			files := map[string]string{"SKILL.md": skill.Content}
			for _, f := range skill.Files {
				files[f.Path] = f.Content
			}
			for path, content := range files {
				for _, b := range banned {
					if m := b.re.FindString(content); m != "" {
						t.Errorf("%s leaks %s (%q); the reader's machine has no copy of this repository — "+
							"state the user-observable behavior instead, and keep the evidence in builtin_skills_test.go", path, b.what, m)
					}
				}
			}
		})
	}
}

// TestPlatformSkillRoutingTableMatchesItsReferences keeps the router honest in
// both directions. A reference the table does not name is unreachable — the
// body is the only thing loaded on activation, so nothing else can point at it
// — and a table row naming a file that does not exist sends the agent to open
// a path that is not there.
func TestPlatformSkillRoutingTableMatchesItsReferences(t *testing.T) {
	skill, ok := findSkill(t, "auro-platform")
	if !ok {
		return
	}
	_, body, _ := splitFrontmatter(skill.Content)

	shipped := make(map[string]bool, len(skill.Files))
	for _, f := range skill.Files {
		shipped[f.Path] = true
		if !strings.HasPrefix(f.Path, "references/") {
			t.Errorf("supporting file %q is not under references/; the routing table only addresses that directory", f.Path)
		}
		if !strings.Contains(body, f.Path) {
			t.Errorf("SKILL.md routing table never names %q, so nothing can reach it", f.Path)
		}
	}

	for _, cited := range regexp.MustCompile("references/[a-z-]+\\.md").FindAllString(body, -1) {
		if !shipped[cited] {
			t.Errorf("SKILL.md points at %q, which the skill does not ship", cited)
		}
	}

	if len(skill.Files) == 0 {
		t.Fatal("platform skill ships no references; the routing body has nothing to route to")
	}
}

// TestPlatformSkillTeachesTheParserContract is the eval that gives the mentions
// reference its value: it proves the skill teaches exactly what
// util.ParseMentions enforces. The skill's "Incorrect" examples must parse to
// nothing (the @gpt-boy class of bug: a name where a UUID belongs fails
// silently), and its "Correct" example must parse. If the mention regex drifts,
// this breaks and the skill's claims must be re-checked.
func TestPlatformSkillTeachesTheParserContract(t *testing.T) {
	const uuid = "7f3a1b2c-0000-4000-8000-000000000abc"

	cases := []struct {
		name    string
		content string
		want    []util.Mention
	}{
		{
			// Skill: "Writing [@Alice](mention://member/Alice) does NOTHING."
			// 'l'/'i' are not hex, so the id fails to parse — link is dead.
			name:    "name where a uuid belongs is silently dead",
			content: "[@Alice](mention://member/Alice) please review",
			want:    nil,
		},
		{
			// Skill: a bare @name is plain text, nobody is notified.
			name:    "bare @name is plain text",
			content: "@alice please review",
			want:    nil,
		},
		{
			// Skill Step 2: type and id source matched → fires.
			name:    "real uuid with matching type fires",
			content: "[@Alice](mention://member/" + uuid + ") please review",
			want:    []util.Mention{{Type: "member", ID: uuid}},
		},
		{
			// Skill: @all uses the literal `all`, never a UUID.
			name:    "all uses the literal all",
			content: "[@all](mention://all/all) heads up",
			want:    []util.Mention{{Type: "all", ID: "all"}},
		},
		{
			// Skill: "Using the wrong type for a real UUID still parses — it
			// just resolves to the wrong entity." Which is exactly why the
			// skill stresses matching type to id source.
			name:    "wrong type still parses (points at wrong entity)",
			content: "[@Bot](mention://member/" + uuid + ")",
			want:    []util.Mention{{Type: "member", ID: uuid}},
		},
		{
			// Skill: `project` is deliberately outside the type group, so a
			// project reference can never start a run.
			name:    "project is not a parseable mention type",
			content: "[Roadmap](mention://project/" + uuid + ")",
			want:    nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := util.ParseMentions(tc.content)
			if len(got) != len(tc.want) {
				t.Fatalf("ParseMentions(%q) = %+v, want %+v", tc.content, got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("mention[%d] = %+v, want %+v", i, got[i], tc.want[i])
				}
			}
		})
	}
}

// TestOnboardingSkillIsScopedToMika pins the agent-scoping rule (MUL-6986).
//
// The onboarding walkthrough is one agent's procedure, not a platform contract.
// Shipping it to every agent put its description in every agent's always-loaded
// skill listing and its body in every task workdir, to be usable by one.
func TestOnboardingSkillIsScopedToMika(t *testing.T) {
	const onboarding = "auro-onboarding"

	svc := &TaskService{}
	ordinary := svc.BuiltinSkills("")
	if named(ordinary, onboarding) {
		t.Errorf("an ordinary agent still receives %q", onboarding)
	}
	if !named(ordinary, "auro-platform") {
		t.Errorf("an ordinary agent does not receive %q, which every agent needs", "auro-platform")
	}

	mika := svc.BuiltinSkills(MikaSystemKey)
	if !named(mika, onboarding) {
		t.Errorf("Mika does not receive %q, which only Mika can use", onboarding)
	}
	if !named(mika, "auro-platform") {
		t.Errorf("Mika lost %q; scoping must add to the universal set, not replace it", "auro-platform")
	}

	// The resolve path deliberately serves any built-in by id — the claim is
	// the gate, and re-deriving the scope there would cost an agent read to
	// re-answer a question the claim already answered.
	if !named(allBuiltinSkillsForTest(), onboarding) {
		t.Errorf("the unscoped set is missing %q; bundle resolution would 404 for Mika's daemon", onboarding)
	}
}

// containsUnwrapped matches an anchor against prose that Markdown has hard
// wrapped. These anchors pin a claim, not a line layout — matching raw bytes
// made every reflow of a paragraph look like a deleted contract, which trains
// authors to fix the test instead of the text.
//
// unwrapped is content already passed through collapseSpace: callers collapse
// each file once, because re-collapsing a whole reference per anchor made this
// the slowest test in the package.
func containsUnwrapped(unwrapped, want string) bool {
	return strings.Contains(unwrapped, collapseSpace(want))
}

var whitespaceRun = regexp.MustCompile(`\s+`)

func collapseSpace(s string) string {
	return strings.TrimSpace(whitespaceRun.ReplaceAllString(s, " "))
}

func named(skills []AgentSkillData, name string) bool {
	for _, s := range skills {
		if s.Name == name {
			return true
		}
	}
	return false
}

// allBuiltinSkillsForTest includes every built-in regardless of agent scope.
func allBuiltinSkillsForTest() []AgentSkillData {
	return (&TaskService{}).AllBuiltinSkills()
}

func findSkill(t *testing.T, name string) (AgentSkillData, bool) {
	t.Helper()
	for _, s := range allBuiltinSkillsForTest() {
		if s.Name == name {
			return s, true
		}
	}
	t.Errorf("built-in skill %q not found", name)
	return AgentSkillData{}, false
}

// splitFrontmatter returns the top-level scalar keys of a leading YAML
// frontmatter block, the body after it, and whether a block was found. It only
// understands flat `key: value` lines — enough for the template's frontmatter.
func splitFrontmatter(content string) (map[string]string, string, bool) {
	if !strings.HasPrefix(content, "---\n") {
		return nil, content, false
	}
	rest := content[len("---\n"):]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return nil, content, false
	}
	block := rest[:end]
	body := rest[end:]
	if nl := strings.Index(body, "\n"); nl >= 0 {
		body = body[nl+1:] // drop the closing --- line
	}

	fm := make(map[string]string)
	for _, line := range strings.Split(block, "\n") {
		if strings.HasPrefix(line, " ") || strings.HasPrefix(line, "\t") {
			continue // nested value; the template uses only flat scalars
		}
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		value = strings.TrimSpace(value)
		value = strings.Trim(value, `"`)
		fm[strings.TrimSpace(key)] = value
	}
	return fm, body, true
}
