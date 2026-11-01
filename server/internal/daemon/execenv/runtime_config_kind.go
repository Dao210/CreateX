package execenv

// taskKind chooses the delivery contract of a retained execution surface.
type taskKind int

const (
	kindExecution taskKind = iota
	kindChat
	kindAutopilotRunOnly
)

func classifyTask(ctx TaskContextForEnv) taskKind {
	if ctx.ChatSessionID != "" {
		return kindChat
	}
	if ctx.AutopilotRunID != "" {
		return kindAutopilotRunOnly
	}
	return kindExecution
}
