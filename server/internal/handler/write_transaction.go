package handler

import (
	"context"

	db "github.com/auro-ai/auro/server/pkg/db/generated"
)

func writeTransaction[T any](h *Handler, ctx context.Context, write func(*db.Queries) (T, error)) (T, error) {
	var zero T
	tx, err := h.TxStarter.Begin(ctx)
	if err != nil {
		return zero, err
	}
	defer tx.Rollback(ctx)
	result, err := write(h.Queries.WithTx(tx))
	if err != nil {
		return zero, err
	}
	if err = tx.Commit(ctx); err != nil {
		return zero, err
	}
	return result, nil
}
