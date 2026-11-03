package daemon

import (
	"fmt"
	"strings"

	"github.com/auro-ai/auro/server/internal/daemon/execenv"
)

// sessionContinuityNoticeFor picks the notice matching what this surface
// actually lost. See the constants in execenv for the full reasoning; the
// question is whether the conversation is still READABLE, not whether it is a
// chat — an issue's comments, a Slack channel's history, and a web chat's /
// Feishu's / WeCom's / DingTalk's chat_message transcript all are (MUL-5722).
func sessionContinuityNoticeFor(task Task) string {
	if task.ChatSessionID == "" {
		return execenv.SessionContinuityNoticeUnrecoverable
	}
	if task.ChatChannelType == execenv.ChannelTypeSlack {
		return execenv.SessionContinuityNoticeChannelHistory
	}
	// Every other chat session that persists a transcript (web chat, Feishu,
	// WeCom, DingTalk) reads it back via `auro chat history`; Slack alone
	// reads the live channel. Only a surface that never stored a transcript
	// falls through to Unrecoverable — see SurfacePersistsTranscript.
	if execenv.SurfacePersistsTranscript(task.ChatChannelType) {
		return execenv.SessionContinuityNoticeChatTranscript
	}
	return execenv.SessionContinuityNoticeUnrecoverable
}

// backendResumeContinuityNotice returns the notice the BACKEND should inject if
// it lands on a fresh thread, or "" when the prompt already carries one.
//
// Only one notice may reach a turn. Two paths can produce it — the daemon,
// which appends it to the prompt whenever it already knows the resume is gone,
// and the backend, which is the only one that can see a live resume RPC being
// rejected mid-run. Before MUL-5722 both fired on the codex overflow retry, so
// the same paragraph was paid for twice in one turn and maintained as two
// hand-written strings. Deriving the backend's copy from the daemon's, and
// suppressing it exactly when the prompt already said it, makes a duplicate
// structurally impossible rather than merely unlikely.
func backendResumeContinuityNotice(task Task) string {
	if task.PriorSessionResumeUnavailable {
		return ""
	}
	return sessionContinuityNoticeFor(task)
}

// perTurnContextBlocks renders the run-scoped context blocks that used to live
// in the runtime brief (CLAUDE.md / AGENTS.md).
//
// Every value here changes from one run to the next on the same issue — the
// authorization human differs between runs, the continuity notice is
// true of one run and false of the next, and the connected-app set is resolved
// per run from the runtime MCP overlay. Claude Code loads the brief into
// messages[0], ahead of the entire conversation, so rendering these there threw
// away the prompt cache for the whole history on every resume. Appending them
// to the per-turn user message puts them after the cached prefix instead, where
// changing them costs only this turn's own tokens (MUL-5377).
//
// Returns "" when none of the blocks apply.
func perTurnContextBlocks(task Task, opts promptOpts) string {
	var b strings.Builder
	b.WriteString(buildSharedLocalDirectoryBlock(opts.sharedLocalDirectory))
	b.WriteString(buildWorktreeReplayConflictBlock(opts.worktreeReplayConflicts))
	if task.PriorSessionResumeUnavailable {
		b.WriteString(sessionContinuityNoticeFor(task))
	}
	b.WriteString(execenv.BuildOnBehalfOfBlock(task.InitiatorName, task.InitiatorEmail))
	b.WriteString(execenv.BuildConnectedAppsBlock(task.ConnectedApps))
	return b.String()
}

// promptOpts carries per-run facts the claimed Task does not: things only the
// daemon's own execution context can answer. Kept behind PromptOption so the
// common BuildPrompt(task, provider) call sites stay unchanged.
type promptOpts struct {
	sharedLocalDirectory    bool
	worktreeReplayConflicts []string
}

// PromptOption tunes per-turn prompt copy with run-scoped context.
type PromptOption func(*promptOpts)

// WithSharedLocalDirectory marks a turn that runs inside the user's own
// directory WITHOUT holding its path mutex — today, a chat turn on an in_place
// local_directory resource (see localDirectoryLockExempt). Such a turn may
// overlap a coding task writing to the same tree, and unlike every other task
// it got there by design rather than by winning the lock, so it is the one that
// has to be told (issue #7344).
func WithSharedLocalDirectory() PromptOption {
	return func(o *promptOpts) { o.sharedLocalDirectory = true }
}

// WithWorktreeReplayConflicts names the files whose merge this turn has to
// finish. Worktree mode continues one branch per conversation, and when the
// user edits the same lines in their own directory between two turns, git
// cannot decide which version wins — so the turn starts on a conflicted tree
// and the agent, which is the only party that knows what the change was FOR,
// resolves it (MUL-6881).
func WithWorktreeReplayConflicts(files []string) PromptOption {
	return func(o *promptOpts) { o.worktreeReplayConflicts = files }
}

// buildSharedLocalDirectoryBlock warns an unlocked turn that its working
// directory is shared live. Deliberately guidance and not a prohibition: the
// mutex never covered the user's own editor either, so refusing writes here
// would buy a restriction the surrounding system does not actually enforce.
// What the turn cannot infer on its own is that a sibling task may be mid-edit
// in the same tree — so state that, and let it size its writes accordingly.
func buildSharedLocalDirectoryBlock(shared bool) string {
	if !shared {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Shared working directory\n\n")
	b.WriteString("Your working directory is the user's own checkout, and another task on this machine may be editing it while you run. This turn deliberately neither holds nor waits for the directory lock — that is what keeps a conversation from queueing behind a long build.\n\n")
	b.WriteString("Read freely. Treat writing the way the user treats saving a file in their own editor: reasonable for a small change they just asked for, wrong for a broad refactor, a dependency install, or a build that rewrites many files. Work that size belongs in an issue task, which is serialised against the other writers. If you do write, say so in your reply — a sibling task may be looking at the same file.\n\n")
	return b.String()
}

// maxConflictListBytes bounds the RENDERED file list, in bytes of the escaped
// output rather than in entries: a git path can be as long as the filesystem
// allows, so a per-entry count bounds nothing. 4 KiB is roughly a thousand
// tokens — small next to any provider's context, large enough for the tens of
// paths a real merge conflict spans, and the remainder is one `git status` away
// inside the worktree. It is the whole block's share of the turn: this text is
// re-sent every turn the merge stays open, and a pathological repository must
// not be able to spend that turn on filenames.
const maxConflictListBytes = 4 << 10

// buildWorktreeReplayConflictBlock tells the turn that its own working tree
// starts out mid-merge, and that finishing that merge comes before the task.
//
// Nothing else can say it: `git status` shows the conflict but not where it
// came from, and the two sides are "what you wrote last turn" and "what the
// user changed since" — neither of which is visible from inside the worktree.
// Silence here is what the earlier version of this feature got wrong: it
// resolved the conflict by discarding the user's edit, which lost that edit
// from every later turn as well.
//
// The names are QUOTED, not wrapped in a code span. They come from the user's
// repository, and a git path may contain newlines, backticks and quotes — a
// raw one could close the list item and continue as its own instruction line in
// the prompt. %q keeps every path on one line with its own delimiters, so a
// crafted filename can only ever read as a filename.
func buildWorktreeReplayConflictBlock(files []string) string {
	if len(files) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("## Unresolved merge in your working tree\n\n")
	b.WriteString("This branch carries your previous turn's work. Since then the user edited the same lines in their own directory, and git could not merge the two (paths are quoted Go string literals — a filename may itself contain quotes or newlines):\n\n")
	listed, used := 0, 0
	for _, file := range files {
		entry := fmt.Sprintf("- %q\n", file)
		// Budget checked before writing, so a single very long path cannot
		// overrun it either — in that case the list is empty and the line below
		// carries the whole count.
		if used+len(entry) > maxConflictListBytes {
			break
		}
		b.WriteString(entry)
		used += len(entry)
		listed++
	}
	if listed < len(files) {
		fmt.Fprintf(&b, "- …and %d more; `git status` in this worktree lists them all\n", len(files)-listed)
	}
	b.WriteString("\nResolve it before anything else, with ordinary git commands — `git status` lists the unmerged paths, `git diff` shows both sides, `git add <file>` marks each one done. The \"ours\" side is what you wrote last turn; \"theirs\" is the user's newer edit, and it is the side you have not seen before, so read it before choosing. Keep both intentions where they are compatible; where they are not, prefer the user's and say so in your reply.\n\n")
	b.WriteString("This run cannot deliver its branch while any file is still unmerged — the task fails and the worktree is kept for a human instead. Do not commit conflict markers.\n\n")
	return b.String()
}

// BuildPrompt constructs the task prompt for an agent CLI.
// Keep this minimal — detailed instructions live in CLAUDE.md / AGENTS.md
// injected by execenv.InjectRuntimeConfig. The provider string is threaded
// through to comment-triggered tasks' per-turn reply template; that template
// is provider-agnostic AND host-agnostic now (every OS → write a UTF-8 file,
// post with `--content-file`) because the shell-layer corruption it guards
// against is not specific to any one provider or host (MUL-2904, #4182).
func BuildPrompt(task Task, provider string, options ...PromptOption) string {
	var opts promptOpts
	for _, apply := range options {
		apply(&opts)
	}
	body := buildPromptBody(task, provider)
	// Run-scoped context is appended, never prepended: everything ahead of it
	// is stable across runs of a resumed session, and appending keeps it after
	// the cached prefix (MUL-5377).
	if blocks := perTurnContextBlocks(task, opts); blocks != "" {
		if !strings.HasSuffix(body, "\n\n") {
			body += "\n"
		}
		body += blocks
	}
	return body
}

func buildPromptBody(task Task, provider string) string {
	if task.ChatSessionID != "" {
		return buildChatPrompt(task)
	}
	if task.AutopilotRunID != "" {
		return buildAutopilotPrompt(task)
	}
	return "Complete the current run's instructions and report the result.\n" + task.HandoffNote
}

// buildChatPrompt constructs a prompt for interactive chat tasks.
func buildChatPrompt(task Task) string {

	var b strings.Builder
	b.WriteString("You are running as a chat assistant for a Auro workspace.\n")
	// Audience is per-session context, so keep it out of the cached runtime
	// brief. The compact anchors here preserve the non-inferable boundaries: a
	// group reply is not private to its sender and people not otherwise present
	// in the run context may read it. Unknown never defaults to private.
	switch execenv.AudienceOf(task.ChatChannelType, task.ChatType) {
	case execenv.ChatAudienceGroup:
		b.WriteString("Audience: group room; not private; unseen members may read replies.\n\n")
	case execenv.ChatAudienceUnknown:
		b.WriteString("Audience: unknown.\n\n")
	default:
		b.WriteString("Audience: direct room.\n\n")
	}
	// Channel awareness (MUL-3871). When the session is backed by an IM channel,
	// the agent must KNOW it is operating inside that channel — otherwise an ask
	// like "what did you just talk about" sends it to read Auro instead of the
	// channel conversation. A web-only chat session gets no such block — its
	// history is the Auro chat_session the agent already resumes.
	//
	// The history half: `auro chat history` is served by handler/chat_history.go,
	// which reads the live channel for Slack and falls back to the stored
	// chat_message transcript for every other surface — so Slack, Feishu, WeCom
	// and DingTalk can all read the conversation back. Slack additionally has
	// `auro chat thread` (thread expansion); the transcript surfaces have no
	// thread reader, so they get the transcript command without the thread
	// drill-down (MUL-4899).
	//
	// WHERE the conversation lives is therefore per-branch, not shared: only the
	// unconditional "don't go looking in issues/comments" survives up top. Saying
	// "its history lives in the channel, NOT in Auro" for every channel type
	// contradicted the very next line on a transcript surface, which tells the
	// agent Auro stored it and hands it the command to read it back. An agent
	// given both reasonably believes the read cannot work and skips it.
	//
	// The no-narration rule is a THIRD axis and belongs to neither half: it is a
	// property of delivering to an IM channel at all, so it is emitted for every
	// channel type. #4776 introduced it that way; the MUL-4899 split moved it into
	// the Slack branch along with the read commands it happened to mention, which
	// silently dropped it for Feishu/Lark (GH #6006).
	if task.ChatChannelType != "" {
		platform := channelDisplayName(task.ChatChannelType)
		fmt.Fprintf(&b, "You are operating inside a %s conversation — not the Auro web app. Never look in Auro issues or comments for this conversation.\n", platform)
		if task.ChatChannelType == execenv.ChannelTypeSlack {
			fmt.Fprintf(&b, "This conversation and its history live in %s, NOT in Auro. The message below may be only what triggered you. Read the conversation with:\n", platform)
			b.WriteString("- `auro chat history --output json` — the channel overview: recent top-level messages, each thread tagged with a `thread_id` and `reply_count`. It does NOT expand thread contents.\n")
			b.WriteString("- `auro chat thread [<thread_id>] --output json` — read one thread's messages; omit the id to read the thread you are in, or pass a `thread_id` from the overview to read a specific thread.\n")
			if task.ChatInThread {
				b.WriteString("You were @mentioned inside a thread: start with `auro chat thread` to read it; if you need the wider channel, run `auro chat history` and open a specific thread with `auro chat thread <thread_id>`.\n")
			} else {
				b.WriteString("You were @mentioned at the channel top level: start with `auro chat history` to see the channel, then read a specific thread's contents with `auro chat thread <thread_id>`.\n")
			}
			// These reads are the agent's private context-gathering; narrating them
			// into a chat reply reads as noise (the user reported every reply being
			// prefixed with "我先读取…"). Tell the agent to keep them out of its answer.
			b.WriteString("Do these reads SILENTLY as an internal step — they are how you gather context, not part of your answer.\n")
		} else if execenv.SurfacePersistsTranscript(task.ChatChannelType) {
			fmt.Fprintf(&b, "The conversation happens in %s, and Auro stores a transcript of it. The message below may be only what triggered you — read it back with `auro chat history` when you need earlier context that is not below.\n", platform)
		} else {
			fmt.Fprintf(&b, "This conversation and its history live in %s, NOT in Auro, and Auro has no history reader for it. Work from the context already provided to you below — no command can fetch more of this conversation. If you genuinely need earlier context that is not here, ask the user for it rather than guessing.\n", platform)
		}
		// Scoped to process, not results — a completion confirmation IS the deliverable.
		fmt.Fprintf(&b, "Reply to %s with the final outcome only. Do NOT narrate planned or in-progress steps (\"我先读取…\"); completed actions are part of the outcome.\n", platform)
		b.WriteString("\n")
	}
	if task.Agent != nil && len(task.Agent.Skills) > 0 {
		refs := ExtractSlashSkills(task.ChatMessage)
		if len(refs) > 0 {
			agentSkills := make(map[string]string, len(task.Agent.Skills))
			for _, s := range task.Agent.Skills {
				agentSkills[s.ID] = s.Name
			}

			selected := make([]string, 0, len(refs))
			seen := make(map[string]struct{}, len(refs))
			for _, ref := range refs {
				name, ok := agentSkills[ref.ID]
				if !ok {
					continue
				}
				if _, ok := seen[ref.ID]; ok {
					continue
				}
				seen[ref.ID] = struct{}{}
				selected = append(selected, name)
			}

			if len(selected) > 0 {
				b.WriteString("Explicitly selected skills:\n")
				for _, name := range selected {
					fmt.Fprintf(&b, "- %s\n", name)
				}
				b.WriteString("\n")
			}
		}
	}
	fmt.Fprintf(&b, "User message:\n%s\n", task.ChatMessage)
	// List attachments by id + filename so the agent can fetch them via
	// the CLI. We deliberately do NOT inline the URL: chat attachments
	// live behind a signed CDN with a short TTL, so by the time the agent
	// has finished thinking the URL embedded in the markdown body may
	// have expired. `auro attachment download <id>` re-signs at click
	// time and is the only reliable path.
	if len(task.ChatMessageAttachments) > 0 {
		b.WriteString("\nAttachments on this message:\n")
		for _, a := range task.ChatMessageAttachments {
			if a.ContentType != "" {
				fmt.Fprintf(&b, "- id=%s filename=%q content_type=%s\n", a.ID, a.Filename, a.ContentType)
			} else {
				fmt.Fprintf(&b, "- id=%s filename=%q\n", a.ID, a.Filename)
			}
		}
		b.WriteString("Use `auro attachment download <id>` to fetch each file locally before referring to it.\n")
	}
	// Outbound attachments: how the agent puts an image/file INTO its reply.
	// This is the DELIVERY layer of the channel policy, and it has three
	// answers, not two (MUL-4899). `attachment upload` binds a file to the
	// Auro chat reply on every surface; what differs is whether anything
	// goes back for it. Web/mobile renders it as a card in the browser. A
	// channel-backed chat gets the upload guidance only where the server said
	// this deployment performs the last hop, and otherwise the upload reaches
	// nobody and the agent must say so in words. The answer arrives on the
	// claim; do not re-derive it from the channel type, do not collapse it back
	// into "is there a channel at all", and do not collapse it into the HISTORY
	// layer above, which is Slack-only and asks a different question.
	//
	// This is the ONLY place the verdict is stated. The brief's `## Output`
	// section carries the web/mobile answer, which is fixed, and for a
	// channel-backed chat points here instead of answering — the verdict flips
	// under a resumed session, and the brief is the prompt-cache prefix
	// (MUL-5377). So a channel chat learns how to deliver a file only from the
	// line below, which means one must be emitted on every turn.
	switch {
	case task.ChatChannelType == "":
		b.WriteString("\nTo include a file or image you produced in your reply, run `auro attachment upload <local-path>`. The file binds to your reply automatically and appears as an attachment card below it even if you paste nothing. The command also returns a `markdown` snippet you may paste on its own line to place the item where you want it (files render as a card, images inline).\n")
	case execenv.ChannelCarriesFiles(task.ChatChannelType, task.ChatChannelDeliversFiles):
		fmt.Fprintf(&b, "\nTo include a file or image you produced in your reply, run `auro attachment upload <local-path>`. It binds to your reply and Auro sends it into the %s conversation as a separate message right after your text — there is no way to place it inline, so write your reply to read correctly with the file arriving after it.\n", channelDisplayName(task.ChatChannelType))
	default:
		fmt.Fprintf(&b, "\nThis reply is delivered to %s as text. You cannot attach a file to it: `auro attachment upload` binds to a Auro chat reply, which this is not. If you produce a file, describe it in words — never write its local path as a link, and never upload it and then write as though it arrived.\n", channelDisplayName(task.ChatChannelType))
	}
	return b.String()
}

// channelDisplayName renders a chat_channel_type for prompt copy. The mapping
// itself lives in execenv so the per-turn prompt (here) and the runtime brief
// (execenv.writeOutput) cannot drift into naming the same platform differently.
func channelDisplayName(channelType string) string {
	return execenv.ChannelDisplayName(channelType)
}

// buildAutopilotPrompt constructs a prompt for run_only autopilot tasks.
func buildAutopilotPrompt(task Task) string {
	var b strings.Builder
	b.WriteString("You are running as a local coding agent for a Auro workspace.\n\n")
	b.WriteString("This task was triggered by an Autopilot in run-only mode. There is no assigned Auro issue for this run.\n\n")
	fmt.Fprintf(&b, "Autopilot run ID: %s\n", task.AutopilotRunID)
	if task.AutopilotID != "" {
		fmt.Fprintf(&b, "Autopilot ID: %s\n", task.AutopilotID)
	}
	if task.AutopilotTitle != "" {
		fmt.Fprintf(&b, "Autopilot title: %s\n", task.AutopilotTitle)
	}
	if task.AutopilotSource != "" {
		fmt.Fprintf(&b, "Trigger source: %s\n", task.AutopilotSource)
	}
	// Rendered whole. Ingress already bounds it — handler.maxWebhookBodyBytes
	// caps a webhook body at 256 KiB — and this is now the payload's ONLY
	// rendering (it used to be in the runtime brief as well), so truncating
	// here would drop task input the agent has no way to fetch back: the
	// full-payload read exists on the server (GET /api/autopilots/{id}/runs/
	// {runId}) but no CLI command exposes it, and `autopilot runs` lists runs
	// without payloads. A cap belongs with that command and a threshold picked
	// from real payload sizes, not as a side effect of de-duplication.
	if payload := strings.TrimSpace(string(task.AutopilotTriggerPayload)); payload != "" {
		fmt.Fprintf(&b, "Trigger payload:\n%s\n", payload)
	}
	b.WriteString("\nAutopilot instructions:\n")
	if strings.TrimSpace(task.AutopilotDescription) != "" {
		b.WriteString(task.AutopilotDescription)
		b.WriteString("\n\n")
	} else if task.AutopilotTitle != "" {
		fmt.Fprintf(&b, "%s\n\n", task.AutopilotTitle)
	} else {
		b.WriteString("No additional autopilot instructions were provided. Inspect the autopilot configuration before proceeding.\n\n")
	}
	if task.AutopilotID != "" {
		fmt.Fprintf(&b, "Start by running `auro autopilot get %s --output json` if you need the full autopilot configuration, then complete the instructions above.\n", task.AutopilotID)
	} else {
		b.WriteString("Complete the instructions above.\n")
	}
	// The issue-command boundary (execenv.AutopilotIssueCommandsGuard) is NOT
	// restated here: the brief's autopilot workflow section is its single
	// emission point, and a second hand-maintained per-turn copy is exactly
	// how the two surfaces drifted into conflict before (MUL-5696).
	return b.String()
}

// squadBriefingMarker is the first heading of the squad-leader briefing the
// server appends to Instructions. It is ONLY a legacy role signal — see
// taskIsSquadLeader — never a role signal against a current server.
const squadBriefingMarker = "## Squad Operating Protocol"
