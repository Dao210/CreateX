package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"
)

type visionHTTP struct {
	response string
	request  map[string]any
	calls    int
}

func (h *visionHTTP) Do(req *http.Request) (*http.Response, error) {
	h.calls++
	if err := json.NewDecoder(req.Body).Decode(&h.request); err != nil {
		return nil, err
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(h.response)), Request: req}, nil
}
func TestVisionStrictTransportAndFailures(t *testing.T) {
	var pngBytes bytes.Buffer
	if err := png.Encode(&pngBytes, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	schema := json.RawMessage(`{"type":"object","properties":{"parts":{"type":"array","items":{"type":"string"}}},"required":["parts"],"additionalProperties":false}`)
	for _, tc := range []struct {
		name, finish, content, refusal string
		success                        bool
	}{
		{"complete", "stop", `{"parts":[]}`, "", true},
		{"truncated", "length", `{"parts":[]}`, "", false},
		{"refused", "stop", "", "cannot interpret", false},
		{"malformed", "stop", "not JSON", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			payload, _ := json.Marshal(map[string]any{"id": "test", "object": "chat.completion", "choices": []any{map[string]any{"index": 0, "finish_reason": tc.finish, "message": map[string]any{"role": "assistant", "content": tc.content, "refusal": tc.refusal}}}, "usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 4}})
			transport := &visionHTTP{response: string(payload)}
			client := New(Config{APIKey: "test-key", BaseURL: "https://vision.example.test/v1", HTTPClient: transport, MaxRetries: retries(0)})
			result, err := client.GenerateVisionJSON(context.Background(), "vision-test", "system", "stroke metadata", pngBytes.Bytes(), schema)
			if (err == nil) != tc.success {
				t.Fatalf("success=%v, error=%v", tc.success, err)
			}
			if transport.calls != 1 {
				t.Fatalf("unexpected negotiation/retries: %d", transport.calls)
			}
			if tc.success && (result.JSON != tc.content || result.InputTokens != 12 || result.OutputTokens != 4) {
				t.Fatalf("result: %+v", result)
			}
			format := transport.request["response_format"].(map[string]any)
			if format["type"] != "json_schema" || format["json_schema"].(map[string]any)["strict"] != true {
				t.Fatalf("not strict: %+v", format)
			}
			messages := transport.request["messages"].([]any)
			content := messages[1].(map[string]any)["content"].([]any)
			url := content[1].(map[string]any)["image_url"].(map[string]any)["url"].(string)
			if !strings.HasPrefix(url, "data:image/png;base64,") {
				t.Fatal("image must be inline")
			}
		})
	}
}

func TestVisionRejectsBadInputBeforeTransport(t *testing.T) {
	transport := &visionHTTP{}
	client := New(Config{APIKey: "test-key", HTTPClient: transport, MaxRetries: retries(0)})
	if _, err := client.GenerateVisionJSON(context.Background(), "test", "", "", []byte("not a PNG"), json.RawMessage(`{}`)); err == nil {
		t.Fatal("accepted malformed image")
	}
	if transport.calls != 0 {
		t.Fatal("invalid input sent upstream")
	}
}
