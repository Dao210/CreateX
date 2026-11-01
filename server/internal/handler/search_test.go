package handler

import (
	"strings"
	"testing"
)

func TestBuildSearchQuery_SingleTerm(t *testing.T) {
	query, args := buildSearchQuery("Hello", []string{"Hello"}, 0, false, false, []string{"done", "cancelled"})

	// Pattern should be lowercased in Go.
	if args[0] != "hello" {
		t.Errorf("expected phrase arg to be lowercased, got %q", args[0])
	}

	// Must use LOWER(column) LIKE, not ILIKE.
	if strings.Contains(query, "ILIKE") {
		t.Error("query should not contain ILIKE")
	}
	if !strings.Contains(query, "lowered_issue_title.lowered LIKE") {
		t.Error("query should match against the pre-lowered issue title")
	}
	if !strings.Contains(query, "lowered_issue_description.lowered LIKE") {
		t.Error("query should match against the conditionally lowered issue description")
	}
	if !strings.Contains(query, "lowered_comment.lowered LIKE") {
		t.Error("query should match against the pre-lowered comment content")
	}

	// Exact title rank should not double-LOWER the pattern.
	if strings.Contains(query, "lowered_issue_title.lowered = LOWER(") {
		t.Error("exact title rank should not wrap pattern in LOWER (already lowercased in Go)")
	}
	if !strings.Contains(query, "lowered_issue_title.lowered = $1") {
		t.Error("exact title rank should compare the lowered title to $1 directly")
	}

	// Should exclude closed issues by default.
	if !strings.Contains(query, "NOT (i.status = ANY(") {
		t.Error("query should exclude the expanded terminal status keys when includeClosed=false")
	}
	if strings.Contains(query, "issue_effective_status") {
		t.Error("query should not resolve status categories once per issue row")
	}
}

func TestBuildSearchQuery_OmitsUnusedExactTotal(t *testing.T) {
	query, _ := buildSearchQuery("Hello", []string{"Hello"}, 0, false, false, []string{"done", "cancelled"})

	if strings.Contains(query, "COUNT(*) OVER()") || strings.Contains(query, "total_count") {
		t.Fatalf("search query should not calculate an unused exact total:\n%s", query)
	}
}

func TestBuildSearchQuery_CustomTerminalStatuses(t *testing.T) {
	terminalStatusKeys := []string{"done", "cancelled", "verified"}
	query, args := buildSearchQuery(
		"Hello",
		[]string{"Hello"},
		0,
		false,
		false,
		terminalStatusKeys,
	)

	if !strings.Contains(query, "NOT (i.status = ANY($5::text[]))") {
		t.Fatalf("query does not filter through the expanded terminal keys:\n%s", query)
	}
	got, ok := args[4].([]string)
	if !ok || len(got) != len(terminalStatusKeys) {
		t.Fatalf("terminal status argument = %#v, want %#v", args[4], terminalStatusKeys)
	}
	for i := range terminalStatusKeys {
		if got[i] != terminalStatusKeys[i] {
			t.Fatalf("terminal status argument = %#v, want %#v", got, terminalStatusKeys)
		}
	}
}

func TestBuildSearchQuery_MultiTerm(t *testing.T) {
	query, args := buildSearchQuery("Foo Bar", []string{"Foo", "Bar"}, 0, false, false, []string{"done", "cancelled"})

	// Both phrase and terms should be lowercased.
	if args[0] != "foo bar" {
		t.Errorf("expected phrase arg lowercased, got %q", args[0])
	}
	// args[0]=exact, args[1]=%phrase%, args[2]=phrase%, args[3]=workspace_id placeholder; term args start at args[4].
	if args[4] != "%foo%" {
		t.Errorf("expected first term arg as contains pattern, got %q", args[4])
	}
	if args[5] != "%bar%" {
		t.Errorf("expected second term arg as contains pattern, got %q", args[5])
	}

	// Multi-word query should have AND conditions.
	if !strings.Contains(query, " AND ") {
		t.Error("multi-word query should contain AND conditions for per-term matching")
	}
}

func TestBuildSearchQuery_LowersCommentContentOnce(t *testing.T) {
	query, _ := buildSearchQuery("Foo Bar Baz", []string{"Foo", "Bar", "Baz"}, 0, false, false, []string{"done", "cancelled"})

	if count := strings.Count(query, "LOWER(c.content)"); count != 1 {
		t.Fatalf("query lowers comment content %d times, want exactly once:\n%s", count, query)
	}
	if !strings.Contains(query, "CROSS JOIN LATERAL (") {
		t.Fatalf("query does not use a lateral join for comment lowercasing:\n%s", query)
	}
	if !strings.Contains(query, "SELECT LOWER(c.content) AS lowered") {
		t.Fatalf("query does not project pre-lowered comment content:\n%s", query)
	}
	if !strings.Contains(query, "OFFSET 0") {
		t.Fatalf("query does not retain the OFFSET 0 planner fence around comment lowercasing:\n%s", query)
	}
	if !strings.Contains(query, ") lowered_comment") {
		t.Fatalf("query does not retain the lateral alias after comment lowercasing:\n%s", query)
	}
	if strings.Contains(query, "LOWER(c.content) LIKE") {
		t.Fatalf("comment predicates bypass the pre-lowered value:\n%s", query)
	}
}

func assertSQLBefore(t *testing.T, query, earlier, later string) {
	t.Helper()
	earlierAt := strings.Index(query, earlier)
	laterAt := strings.Index(query, later)
	if earlierAt == -1 || laterAt == -1 || earlierAt > laterAt {
		t.Fatalf("query must keep %q before %q:\n%s", earlier, later, query)
	}
}

func TestBuildSearchQuery_WithNumber(t *testing.T) {
	query, args := buildSearchQuery("MUL-42", []string{"MUL-42"}, 42, true, false, []string{"done", "cancelled"})

	_ = args
	// Number match should be in WHERE.
	if !strings.Contains(query, "i.number = ") {
		t.Error("query should contain number match in WHERE clause")
	}
	// Tier 0 rank for identifier match.
	if !strings.Contains(query, "THEN 0") {
		t.Error("query should contain tier 0 rank for identifier match")
	}
}

func TestBuildSearchQuery_IncludeClosed(t *testing.T) {
	query, _ := buildSearchQuery("test", []string{"test"}, 0, false, true, nil)

	if strings.Contains(query, "i.status = ANY(") {
		t.Error("query should not exclude done/cancelled when includeClosed=true")
	}
}

func TestBuildSearchQuery_SpecialChars(t *testing.T) {
	query, args := buildSearchQuery("100%", []string{"100%"}, 0, false, false, []string{"done", "cancelled"})

	_ = query
	// % should be escaped in the phrase arg.
	if escaped, ok := args[0].(string); !ok || !strings.Contains(escaped, `\%`) {
		t.Errorf("expected %% to be escaped in phrase arg, got %q", args[0])
	}
}

// --- Project search tests ---

// --- extractSnippet regression tests ---

func TestExtractSnippet_PhraseMatch(t *testing.T) {
	content := "The quick brown fox jumps over the lazy dog near the river bank"
	snippet := extractSnippet(content, "brown fox")
	if !strings.Contains(snippet, "brown fox") {
		t.Errorf("snippet should contain the phrase 'brown fox', got %q", snippet)
	}
}

func TestExtractSnippet_MultiWordNonContiguous(t *testing.T) {
	// "deploy" and "kubernetes" both appear but not as a contiguous phrase.
	content := "We need to deploy the new service. The kubernetes cluster is ready for production workloads."
	snippet := extractSnippet(content, "deploy kubernetes")
	// Should NOT fall back to first 120 chars blindly — should center on earliest term.
	if !strings.Contains(strings.ToLower(snippet), "deploy") && !strings.Contains(strings.ToLower(snippet), "kubernetes") {
		t.Errorf("snippet should contain at least one search term, got %q", snippet)
	}
	// Specifically, "deploy" appears first so snippet should be centered around it.
	if !strings.Contains(strings.ToLower(snippet), "deploy") {
		t.Errorf("snippet should center on earliest term 'deploy', got %q", snippet)
	}
}

func TestExtractSnippet_FallbackWhenNoMatch(t *testing.T) {
	content := strings.Repeat("a", 200)
	snippet := extractSnippet(content, "zzz")
	if len([]rune(snippet)) > 124 { // 120 + "..."
		t.Errorf("snippet should be truncated to ~120 runes when no match, got len=%d", len([]rune(snippet)))
	}
}

func TestExtractSnippet_ShortContent(t *testing.T) {
	content := "short text"
	snippet := extractSnippet(content, "missing")
	if snippet != content {
		t.Errorf("short content with no match should return as-is, got %q", snippet)
	}
}

func TestExtractSnippet_CaseInsensitive(t *testing.T) {
	content := "Error in HTML rendering pipeline"
	snippet := extractSnippet(content, "html")
	if !strings.Contains(snippet, "HTML") {
		t.Errorf("snippet should find case-insensitive match, got %q", snippet)
	}
}

func TestExtractSnippet_CJKContent(t *testing.T) {
	content := "这是一段很长的中文内容，包含了搜索关键词测试用例，用来验证多字节字符不会被截断的情况"
	snippet := extractSnippet(content, "搜索关键词")
	if !strings.Contains(snippet, "搜索关键词") {
		t.Errorf("snippet should contain CJK phrase, got %q", snippet)
	}
}

// --- Ranking regression tests ---

func TestBuildSearchQuery_CommentRankTiers(t *testing.T) {
	query, _ := buildSearchQuery("test phrase", []string{"test", "phrase"}, 0, false, false, []string{"done", "cancelled"})

	// Comment phrase match should be tier 7
	if !strings.Contains(query, "THEN 7") {
		t.Error("query should contain tier 7 for comment phrase match")
	}
	// Comment all-term match should be tier 8
	if !strings.Contains(query, "THEN 8") {
		t.Error("query should contain tier 8 for comment all-term match")
	}
	// Fallback should be 9, not 7
	if !strings.Contains(query, "ELSE 9") {
		t.Error("query fallback should be ELSE 9")
	}
}

func TestBuildSearchQuery_DescriptionRankTiers(t *testing.T) {
	query, _ := buildSearchQuery("foo bar", []string{"foo", "bar"}, 0, false, false, []string{"done", "cancelled"})

	// Description phrase match should be tier 5
	if !strings.Contains(query, "THEN 5") {
		t.Error("query should contain tier 5 for description phrase match")
	}
	// Description all-term match should be tier 6
	if !strings.Contains(query, "THEN 6") {
		t.Error("query should contain tier 6 for description all-term match")
	}
}

func TestBuildSearchQuery_SingleTermNoAllTermTiers(t *testing.T) {
	query, _ := buildSearchQuery("html", []string{"html"}, 0, false, false, []string{"done", "cancelled"})

	// Extract the rank CASE expression (ends with "ELSE 9 END") to avoid
	// false matches against statusRank which also contains THEN 4/6.
	rankEnd := strings.Index(query, "ELSE 9 END")
	if rankEnd == -1 {
		t.Fatal("query should contain rank expression with ELSE 9 END")
	}
	rankExpr := query[:rankEnd]

	// Single-term queries should NOT have tier 4 (title all-terms), 6 (desc all-terms), or 8 (comment all-terms)
	if strings.Contains(rankExpr, "THEN 4") {
		t.Error("single-term query should not have tier 4 (title all-terms)")
	}
	if strings.Contains(rankExpr, "THEN 6") {
		t.Error("single-term query should not have tier 6 (description all-terms)")
	}
	if strings.Contains(rankExpr, "THEN 8") {
		t.Error("single-term query should not have tier 8 (comment all-terms)")
	}
}

// --- MUL-5824: cancelled work must not outrank live work ---

// orderByClause returns everything after the final ORDER BY, so ranking-order
// assertions cannot be satisfied by an expression that merely appears in the
// SELECT list or the WHERE clause.
func orderByClause(t *testing.T, query string) string {
	t.Helper()
	i := strings.LastIndex(query, "ORDER BY ")
	if i == -1 {
		t.Fatalf("query has no ORDER BY clause:\n%s", query)
	}
	return query[i+len("ORDER BY "):]
}

// The cancelled demotion must sort BEFORE the relevance tiers, not after.
// As a tie-breaker it would be inert: statusRank only orders issues that
// already landed in the same tier, so an exactly-titled cancelled issue
// (tier 1) would still beat an in_progress title-contains match (tier 3).
func TestBuildSearchQuery_CancelledDemotedAheadOfRelevance(t *testing.T) {
	query := buildSearchQueryForTest(t, "login bug", []string{"login", "bug"}, 0, false, true)
	if !strings.Contains(query, "CASE WHEN im.status = 'cancelled' AND NOT (im.title_exact) THEN 1 ELSE 0 END AS cancelled_rank") {
		t.Fatalf("ranked candidates have no cancelled demotion:\n%s", query)
	}

	orderBy := orderByClause(t, query)
	if !strings.HasPrefix(orderBy, "pc.cancelled_rank, pc.relevance_rank, pc.status_rank") {
		t.Errorf("cancelled demotion does not sort before relevance and status:\n%s", orderBy)
	}

	// The demotion must not replace the existing status ordering.
	if !strings.Contains(query, "WHEN 'in_progress' THEN 0") {
		t.Errorf("statusRank was dropped from ranked candidates:\n%s", query)
	}
	if !strings.Contains(orderBy, "pc.updated_at DESC") {
		t.Errorf("recency tie-breaker was dropped from ORDER BY:\n%s", orderBy)
	}
	if !strings.Contains(orderBy, "pc.issue_id ASC") {
		t.Errorf("stable issue ID tie-breaker was dropped from ORDER BY:\n%s", orderBy)
	}
}

// Searching an exact title or an exact identifier is unambiguous targeting —
// the searcher already knows which issue they want, so demoting it would just
// hide the row they asked for.
func TestBuildSearchQuery_CancelledDirectHitExempt(t *testing.T) {
	textOnly := buildSearchQueryForTest(t, "ship it", []string{"ship", "it"}, 0, false, true)
	if !strings.Contains(textOnly, "im.status = 'cancelled' AND NOT (im.title_exact)") {
		t.Errorf("exact-title hit is not exempt from the cancelled demotion:\n%s", textOnly)
	}
	if strings.Contains(textOnly, "number_exact") {
		t.Errorf("non-numeric query should not reference i.number in the demotion:\n%s", textOnly)
	}

	withNumber := buildSearchQueryForTest(t, "MUL-42", []string{"MUL-42"}, 42, true, true)
	if !strings.Contains(withNumber, "NOT (im.title_exact OR im.number_exact)") {
		t.Errorf("identifier lookup is not exempt from the cancelled demotion, so MUL-42 sinks below every fuzzy match:\n%s", withNumber)
	}
}

// 'done' is finished work worth referencing; only 'cancelled' is thrown away.
func TestBuildSearchQuery_DoneNotDemotedAheadOfRelevance(t *testing.T) {
	query := buildSearchQueryForTest(t, "login", []string{"login"}, 0, false, true)
	if strings.Contains(query, "CASE WHEN im.status = 'done'") {
		t.Errorf("done issues were demoted ahead of relevance; only cancelled should be:\n%s", query)
	}
	if !strings.Contains(query, "WHEN 'done' THEN 5") {
		t.Errorf("done status tie-breaker was dropped:\n%s", query)
	}
}

// buildSearchQuery mutates the terms slice in place (lowercasing); this wrapper
// keeps each test's literals independent.
func buildSearchQueryForTest(t *testing.T, phrase string, terms []string, num int, hasNum bool, includeClosed bool) string {
	t.Helper()
	query, _ := buildSearchQuery(phrase, append([]string(nil), terms...), num, hasNum, includeClosed, []string{"done", "cancelled"})
	return query
}
