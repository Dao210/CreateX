package execenv

const SessionContinuityNoticeChannelHistory = "## Session Continuity Notice\n\n" +
	"This run was meant to continue an earlier conversation, but that provider session could not be restored, and this run does not continue it. The channel conversation itself is unaffected — read it back with `auro chat history` / `auro chat thread` before acting, and treat what you find there as the authoritative version. What is gone is your own working memory from the turns that did not come back: what you already tried, what you ruled out, and how far you had got. Re-derive what you need instead of assuming it. Do not open your reply by announcing this — raise it only where it actually matters.\n\n"

const SessionContinuityNoticeChatTranscript = "## Session Continuity Notice\n\n" +
	"This run was meant to continue an earlier conversation, but that provider session could not be restored, and this run does not continue it. The conversation itself is unaffected — Auro stored it, and you can read it back with `auro chat history` before acting; treat what you find there as the authoritative version. What is gone is your own working memory from the turns that did not come back: what you already tried, what you ruled out, and how far you had got. Re-derive what you need instead of assuming it. Do not open your reply by announcing this — raise it only where it actually matters.\n\n"

const SessionContinuityNoticeUnrecoverable = "## Session Continuity Notice\n\n" +
	"This run was meant to continue an earlier conversation, but that session's context could NOT be restored — you are starting fresh with no memory of the previous turns. That history is not readable from anywhere now: there is no command that fetches it, and only the context already in this message survives. **When you reply, tell the user up front (one short sentence) that the previous conversation context was unavailable and this is a new session**, so they understand why the thread did not carry over.\n\n"
