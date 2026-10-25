package channel

import "testing"

func TestIssueWebLink(t *testing.T) {
	t.Parallel()

	if got, want := IssueWebLink("https://app.auro.test/", "demo-web", "MUL-42"), "https://app.auro.test/demo-web/issues/MUL-42"; got != want {
		t.Fatalf("IssueWebLink with workspace slug = %q, want %q", got, want)
	}
	if got := IssueWebLink("https://app.auro.test", "", "MUL-42"); got != "" {
		t.Fatalf("IssueWebLink without workspace slug = %q, want empty: a workspace-less path cannot route to the issue", got)
	}
	if got := IssueWebLink("", "demo-web", "MUL-42"); got != "" {
		t.Fatalf("IssueWebLink without app URL = %q, want empty", got)
	}
	if got := IssueWebLink("https://app.auro.test", "demo-web", ""); got != "" {
		t.Fatalf("IssueWebLink without identifier = %q, want empty", got)
	}
}
