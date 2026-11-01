package service

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

type webhookTaskReadTrace struct {
	reads   int
	maxRows int64
}
type webhookTaskReadTraceKey struct{}

func (tr *webhookTaskReadTrace) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return context.WithValue(ctx, webhookTaskReadTraceKey{}, strings.Contains(data.SQL, "FROM agent_task_queue"))
}
func (tr *webhookTaskReadTrace) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	if tracked, _ := ctx.Value(webhookTaskReadTraceKey{}).(bool); tracked {
		tr.reads++
		tr.maxRows = max(tr.maxRows, data.CommandTag.RowsAffected())
	}
}
