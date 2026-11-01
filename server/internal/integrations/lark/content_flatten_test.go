package lark

import (
	"strings"
	"testing"
)

func TestFlattenPostContent_NoTitle(t *testing.T) {
	t.Parallel()
	raw := `{"content":[[{"tag":"text","text":"line one"}],[{"tag":"text","text":"line two"}]]}`
	want := "line one\nline two"
	if got := flattenPostContent(raw); got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestFlattenPostContent_MediaAndMentionSpans(t *testing.T) {
	t.Parallel()
	// at span carries the @_user_N placeholder (resolved later by
	// resolveMentions); media tags degrade to bracket placeholders;
	// emotion is skipped entirely.
	raw := `{"content":[[
		{"tag":"at","user_id":"@_user_1","user_name":""},
		{"tag":"text","text":"look"},
		{"tag":"img","image_key":"img_x"},
		{"tag":"emotion","emoji_type":"SMILE"}
	]]}`
	want := "@_user_1 look [Image]"
	if got := flattenPostContent(raw); got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestFlattenPostContent_AtPrefersPlaceholderWhenBothPresent(t *testing.T) {
	t.Parallel()
	raw := `{"content":[[{"tag":"at","user_id":"@_user_1","user_name":"ReviewBot"}]]}`
	want := "@_user_1"
	if got := flattenPostContent(raw); got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestFlattenPostContent_AtFallsBackToUserNameWhenNoPlaceholder(t *testing.T) {
	t.Parallel()
	raw := `{"content":[[{"tag":"at","user_id":"","user_name":"ReviewBot"}]]}`
	want := "@ReviewBot"
	if got := flattenPostContent(raw); got != want {
		t.Errorf("got %q want %q", got, want)
	}
}

func TestFlattenPostContent_TopicGroupMentionSlashCommand(t *testing.T) {
	t.Parallel()
	raw := `{"content":[[{"tag":"at","user_id":"@_user_1","user_name":"ReviewBot"},{"tag":"text","text":" /issue review this"}]]}`
	flat := flattenPostContent(raw)
	m := larkMention{Key: "@_user_1", Name: "ReviewBot"}
	m.ID.OpenID = "ou_bot"
	mentions := []larkMention{m}
	got := resolveMentions(flat, mentions, "ou_bot", "")
	got = strings.TrimSpace(got)
	if want := "/issue review this"; got != want {
		t.Errorf("after resolveMentions got %q want %q (flat was %q)", got, want, flat)
	}
	if len(got) == 0 || got[0] != '/' {
		t.Errorf("first line should start with '/', got %q", got)
	}
}

func TestFlattenPostContent_Malformed(t *testing.T) {
	t.Parallel()
	if got := flattenPostContent("not json"); got != "" {
		t.Errorf("malformed content should flatten to empty, got %q", got)
	}
	if got := flattenPostContent(""); got != "" {
		t.Errorf("empty content should flatten to empty, got %q", got)
	}
}

func TestFlattenContent_DispatchByType(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name    string
		msgType string
		content string
		want    string
	}{
		{"text", "text", `{"text":"hello"}`, "hello"},
		{"image", "image", `{"image_key":"img_x"}`, "[Image]"},
		{"file", "file", `{"file_key":"f"}`, "[File]"},
		{"audio", "audio", `{"file_key":"f"}`, "[Audio]"},
		{"media", "media", `{"file_key":"f"}`, "[Video]"},
		{"video", "video", `{"file_key":"f"}`, "[Video]"},
		{"sticker", "sticker", `{"file_key":"f"}`, "[Sticker]"},
		{"interactive", "interactive", `{"title":"t"}`, "[interactive card]"},
		{"share_chat", "share_chat", `{"chat_id":"oc"}`, "[Shared Chat]"},
		{"merge_forward", "merge_forward", `{"content":"Merged and Forwarded Message"}`, "[forwarded messages]"},
		{"unknown", "totally_new_type", `{}`, ""},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := flattenContent(tc.msgType, tc.content); got != tc.want {
				t.Errorf("flattenContent(%q) = %q want %q", tc.msgType, got, tc.want)
			}
		})
	}
}
