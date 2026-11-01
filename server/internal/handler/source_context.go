package handler

import (
	"errors"

	"github.com/auro-ai/auro/server/internal/service"
)

var errSourceContextResponseWritten = errors.New("source context response already written")
var errSourceContextBadRequest = errors.New("source context bad request")

type sourceContextAuthorState struct {
	Type         string  `json:"type"`
	ID           string  `json:"id"`
	CapturedName string  `json:"captured_name"`
	CurrentName  *string `json:"current_name,omitempty"`
	State        string  `json:"state"`
}

type sourceContextCurrentSource struct {
	IssueID         string `json:"issue_id"`
	AnchorCommentID string `json:"anchor_comment_id"`
	Identifier      string `json:"identifier"`
}

type sourceContextDetailResponse struct {
	ID                   string                        `json:"id"`
	Version              int16                         `json:"version"`
	Usage                string                        `json:"usage"`
	CapturedAt           string                        `json:"captured_at"`
	DisplayState         string                        `json:"display_state"`
	SourceIssueState     string                        `json:"source_issue_state"`
	CommentThreadState   string                        `json:"comment_thread_state"`
	AnchorCommentState   string                        `json:"anchor_comment_state"`
	CanOpenCurrentSource bool                          `json:"can_open_current_source"`
	ChangeReasons        []string                      `json:"change_reasons"`
	ChangeDetails        sourceContextChangeDetails    `json:"change_details"`
	Snapshot             service.SourceContextSnapshot `json:"snapshot"`
	CurrentSource        *sourceContextCurrentSource   `json:"current_source,omitempty"`
	SourceAuthorState    []sourceContextAuthorState    `json:"source_author_state"`
}

type sourceContextChangeDetails struct {
	ChangedCommentIDs            []string                                   `json:"changed_comment_ids"`
	AddedComments                []service.SourceContextCommentSnapshot     `json:"added_comments,omitempty"`
	RemovedCommentIDs            []string                                   `json:"removed_comment_ids,omitempty"`
	DescriptionAttachmentChanges []sourceContextDescriptionAttachmentChange `json:"description_attachment_changes"`
}

type sourceContextDescriptionAttachmentChange struct {
	Kind             string `json:"kind"`
	AttachmentID     string `json:"attachment_id"`
	Filename         string `json:"filename"`
	PreviousFilename string `json:"previous_filename,omitempty"`
}
