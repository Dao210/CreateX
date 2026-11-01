package handler

type IssueReactionResponse struct {
	ID            string `json:"id"`
	IssueID       string `json:"issue_id"`
	ActorType     string `json:"actor_type"`
	ActorID       string `json:"actor_id"`
	Emoji         string `json:"emoji"`
	CreatedAt     string `json:"created_at"`
	IssueRevision *int64 `json:"issue_revision,omitempty"`
}
