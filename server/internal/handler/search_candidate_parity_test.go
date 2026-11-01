package handler

import (
	"context"
	"testing"
)

type searchParityRow struct {
	id                    string
	matchSource           string
	matchedCommentContent string
}

func runBuiltSearchForParity(t *testing.T, phrase string, includeClosed bool, terminalKeys []string, limit, offset int) []searchParityRow {
	t.Helper()
	terms := splitSearchTerms(phrase)
	queryNum, hasNum := parseQueryNumber(phrase)
	query, args := buildSearchQuery(phrase, terms, queryNum, hasNum, includeClosed, terminalKeys)
	args[3] = testWorkspaceID
	args[len(args)-2] = limit
	args[len(args)-1] = offset
	return runCandidateSearchForParity(t, query, args)
}

func findSearchParityRow(rows []searchParityRow, id string) (searchParityRow, bool) {
	for _, row := range rows {
		if row.id == id {
			return row, true
		}
	}
	return searchParityRow{}, false
}

func runCandidateSearchForParity(t *testing.T, query string, args []any) []searchParityRow {
	return runSearchForParity(t, "candidate", query, args)
}

func runLegacySearchForParity(t *testing.T, query string, args []any) []searchParityRow {
	return runSearchForParity(t, "legacy", query, args)
}

func runSearchForParity(t *testing.T, label, query string, args []any) []searchParityRow {
	t.Helper()
	rows, err := testPool.Query(context.Background(), query, args...)
	if err != nil {
		t.Fatalf("run %s search: %v\n%s", label, err, query)
	}
	defer rows.Close()

	var result []searchParityRow
	for rows.Next() {
		var sr searchResult
		if err := rows.Scan(
			&sr.issue.ID,
			&sr.issue.WorkspaceID,
			&sr.issue.Title,
			&sr.issue.Description,
			&sr.issue.Status,
			&sr.issue.Priority,
			&sr.issue.AssigneeType,
			&sr.issue.AssigneeID,
			&sr.issue.CreatorType,
			&sr.issue.CreatorID,
			&sr.issue.ParentIssueID,
			&sr.issue.AcceptanceCriteria,
			&sr.issue.ContextRefs,
			&sr.issue.Position,
			&sr.issue.StartDate,
			&sr.issue.DueDate,
			&sr.issue.CreatedAt,
			&sr.issue.UpdatedAt,
			&sr.issue.LastActivityAt,
			&sr.issue.Number,
			&sr.issue.ProjectID,
			&sr.issue.Revision,
			&sr.issue.DuplicateOfIssueID,
			&sr.matchSource,
			&sr.matchedCommentContent,
		); err != nil {
			t.Fatalf("scan %s row: %v", label, err)
		}
		result = append(result, searchParityRow{
			id:                    uuidToString(sr.issue.ID),
			matchSource:           sr.matchSource,
			matchedCommentContent: sr.matchedCommentContent,
		})
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("%s rows: %v", label, err)
	}
	return result
}
