// Package adminauth owns platform authority, independently of workspace roles.
package adminauth

import (
	"context"
	"errors"
	"fmt"
	"net/mail"
	"strings"

	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrForbidden = errors.New("admin_forbidden")

type Gate struct {
	Pool   *pgxpool.Pool
	emails map[string]bool
}

func New(pool *pgxpool.Pool, raw string) (*Gate, error) {
	g := &Gate{Pool: pool, emails: map[string]bool{}}
	for _, value := range strings.FieldsFunc(raw, func(r rune) bool { return r == ',' || r == ';' || r == '\n' }) {
		value = strings.ToLower(strings.TrimSpace(value))
		if value == "" {
			continue
		}
		parsed, err := mail.ParseAddress(value)
		if err != nil || parsed.Address != value {
			return nil, fmt.Errorf("AURO_ADMIN_EMAILS must contain comma-separated login email addresses")
		}
		g.emails[value] = true
	}
	return g, nil
}

func (g *Gate) Configured() bool { return len(g.emails) > 0 }
func (g *Gate) AllowsEmail(email string) bool {
	return g.emails[strings.ToLower(strings.TrimSpace(email))]
}
func (g *Gate) IsAdmin(ctx context.Context, userID string) (bool, error) {
	if !g.Configured() {
		return false, nil
	}
	id, err := util.ParseUUID(userID)
	if err != nil {
		return false, ErrForbidden
	}
	user, err := db.New(g.Pool).GetUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return g.AllowsEmail(user.Email), nil
}

// LockActor rechecks the login email inside the policy transaction.
func (g *Gate) LockActor(ctx context.Context, q *db.Queries, userID string) error {
	id, err := util.ParseUUID(userID)
	if err != nil {
		return ErrForbidden
	}
	email, err := q.LockGlobalAdminUser(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrForbidden
	}
	if err != nil {
		return err
	}
	if !g.AllowsEmail(email) {
		return ErrForbidden
	}
	return nil
}
