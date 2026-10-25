package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image/png"
	"strings"

	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/shared"
)

type VisionResult struct {
	JSON         string
	InputTokens  int64
	OutputTokens int64
}

var ErrVisionRefused = errors.New("llm: vision refused")
var ErrVisionIncomplete = errors.New("llm: incomplete vision output")
var ErrVisionInvalidOutput = errors.New("llm: invalid vision JSON")

// GenerateVisionJSON sends one bounded PNG and a strict schema without protocol negotiation.
func (c *Client) GenerateVisionJSON(ctx context.Context, model, system, prompt string, image []byte, schema json.RawMessage) (VisionResult, error) {
	if !c.Enabled() {
		return VisionResult{}, ErrNotConfigured
	}
	if len(image) == 0 || len(image) > 1024*1024 || !json.Valid(schema) {
		return VisionResult{}, errors.New("llm: invalid vision input")
	}
	config, err := png.DecodeConfig(bytes.NewReader(image))
	if err != nil || config.Width > 1024 || config.Height > 1024 {
		return VisionResult{}, errors.New("llm: invalid PNG")
	}
	user := openai.ChatCompletionMessageParamUnion{OfUser: &openai.ChatCompletionUserMessageParam{
		Content: openai.ChatCompletionUserMessageParamContentUnion{OfArrayOfContentParts: []openai.ChatCompletionContentPartUnionParam{
			openai.TextContentPart(prompt),
			openai.ImageContentPart(openai.ChatCompletionContentPartImageImageURLParam{URL: "data:image/png;base64," + base64.StdEncoding.EncodeToString(image), Detail: "high"}),
		}},
	}}
	response, err := c.Chat(ctx, openai.ChatCompletionNewParams{
		Model:               shared.ChatModel(model),
		Messages:            []openai.ChatCompletionMessageParamUnion{openai.SystemMessage(system), user},
		MaxCompletionTokens: openai.Int(2500),
		ResponseFormat: openai.ChatCompletionNewParamsResponseFormatUnion{OfJSONSchema: &shared.ResponseFormatJSONSchemaParam{
			JSONSchema: shared.ResponseFormatJSONSchemaJSONSchemaParam{Name: "siege_weapon", Strict: openai.Bool(true), Schema: schema},
		}},
	})
	if err != nil {
		return VisionResult{}, err
	}
	if len(response.Choices) != 1 || response.Choices[0].FinishReason != "stop" {
		return VisionResult{}, ErrVisionIncomplete
	}
	message := response.Choices[0].Message
	if message.Refusal != "" {
		return VisionResult{}, ErrVisionRefused
	}
	if strings.TrimSpace(message.Content) == "" || !json.Valid([]byte(message.Content)) {
		return VisionResult{}, ErrVisionInvalidOutput
	}
	return VisionResult{JSON: message.Content, InputTokens: response.Usage.PromptTokens, OutputTokens: response.Usage.CompletionTokens}, nil
}
