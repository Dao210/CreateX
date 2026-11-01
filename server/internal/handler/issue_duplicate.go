package handler

import (
	"errors"

	"github.com/jackc/pgx/v5/pgtype"
)

// Duplicate marks (MUL-7349). A duplicate is an ordinary cancelled issue that
// remembers which issue it duplicates: there is no duplicate status. Setting
// the mark goes through UpdateIssue as a status write, and any status change
// away from cancelled clears it in SQL (UpdateIssue / UpdateIssueStatus).
//
// The relation stays one level deep in both directions: a target must not be
// a duplicate itself, and an issue that others are marked as duplicates of
// cannot be marked. Nothing is collapsed or re-pointed automatically.
//
// The column and the code that maintains it shipped one release earlier, so a
// rollback lands on a server that still clears the pointer when an issue is
// reopened or its original deleted. Reads below additionally require the
// duplicate to be cancelled and its original to exist, which keeps a rollback
// that goes back further than that release readable rather than wrong.

var (
	errDuplicateTargetNotFound    = errors.New("duplicate target not found in this workspace")
	errDuplicateTargetIsDuplicate = errors.New("duplicate target is itself a duplicate")
	errIssueHasDuplicates         = errors.New("issue has duplicates")
)

// liveDuplicateMark renders one end of a mark change for an issue:updated
// payload: the pointer only while it counts, i.e. the issue is cancelled. A
// pointer an older server left on a reopened issue is no mark, so a write
// that clears it is not a mark being removed.
func liveDuplicateMark(status string, id pgtype.UUID) *string {
	return uuidToPtr(duplicateOfPointer(status, id))
}
