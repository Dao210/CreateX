// Package adminstats serves read-only platform aggregates (users, workspaces,
// membership, client activity) for the operations-facing admin stats module.
// It follows the gameadmin/mcpadmin pattern: a dedicated package with its own
// ServeMux, gated by the shared adminauth.Gate email allowlist.
package adminstats

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/auro-ai/auro/server/internal/adminauth"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalid = errors.New("invalid_admin_request")

const (
	// defaultTrendDays and maxTrendDays bound the ?days= parameter, matching
	// the dashboard family's 1..365 window.
	defaultTrendDays = 30
	maxTrendDays     = 365
	// queryTimeout caps each aggregate below the server's typical request
	// budget; the queries are single-pass counts over modest tables.
	queryTimeout = 5 * time.Second
	// snapshotTTL caches the unparameterized overview/breakdown payloads so a
	// roomful of operators refreshing does not re-run every count on click.
	snapshotTTL = 60 * time.Second
)

// Counter is a total with rolling new-in-window deltas.
type Counter struct {
	Total int64 `json:"total"`
	New1d int64 `json:"new1d"`
	New7d int64 `json:"new7d"`
	New30d int64 `json:"new30d"`
}

// ActiveWindow counts distinct humans seen in the client_usage_daily table
// within the rolling window. It only reflects clients that reported usage;
// the UI labels the metric accordingly.
type ActiveWindow struct {
	Day   int64 `json:"day"`
	Week  int64 `json:"week"`
	Month int64 `json:"month"`
}

type Overview struct {
	Users      Counter `json:"users"`
	Workspaces Counter `json:"workspaces"`
	Members    int64   `json:"members"`
	// ActiveUsers counts distinct users with a client_usage_daily row whose
	// last_active_at falls inside the window (rolling, not calendar buckets).
	ActiveUsers ActiveWindow `json:"activeUsers"`
	// ActiveDaemons counts distinct daemons seen in the last 24 hours.
	ActiveDaemons int64 `json:"activeDaemons"`
	// PendingInvitations is the current backlog of unanswered invites.
	PendingInvitations int64 `json:"pendingInvitations"`
	// GeneratedAt is the snapshot time (UTC); cached payloads keep their
	// original stamp so operators can see how fresh the numbers are.
	GeneratedAt time.Time `json:"generatedAt"`
}

// TrendPoint is one calendar day (in the requested timezone) of the three
// merged series: new users, new workspaces and distinct active users.
type TrendPoint struct {
	Date               string `json:"date"`
	NewUsers           int64  `json:"newUsers"`
	NewWorkspaces      int64  `json:"newWorkspaces"`
	ActiveUsers        int64  `json:"activeUsers"`
	ActiveUsersWeb     int64  `json:"activeUsersWeb"`
	ActiveUsersDesktop int64  `json:"activeUsersDesktop"`
}

type Trends struct {
	Tz     string        `json:"tz"`
	Days   int           `json:"days"`
	Series []TrendPoint  `json:"series"`
}

// CountEntry is a labeled count with a stable key for locale lookup.
type CountEntry struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

type Breakdown struct {
	Invitations    []CountEntry `json:"invitations"`
	MemberRoles    []CountEntry `json:"memberRoles"`
	WorkspaceSizes []CountEntry `json:"workspaceSizes"`
	GeneratedAt    time.Time    `json:"generatedAt"`
}

var (
	invitationOrder = []string{"pending", "accepted", "declined", "expired"}
	roleOrder       = []string{"owner", "admin", "member"}
	sizeOrder       = []string{"0", "1", "2-4", "5+"}
)

type Service struct {
	Pool *pgxpool.Pool
	Auth *adminauth.Gate

	overviewCache  ttlCache[Overview]
	breakdownCache ttlCache[Breakdown]
}

// ttlCache memoizes one value for a fixed window. Concurrent misses may
// compute twice; at this scale that is cheaper than lock-held fetches that
// would serialize every admin request behind one DB round trip.
type ttlCache[T any] struct {
	mu    sync.Mutex
	value T
	at    time.Time
}

func (c *ttlCache[T]) get(ctx context.Context, ttl time.Duration, fn func(context.Context) (T, error)) (T, error) {
	c.mu.Lock()
	if !c.at.IsZero() && time.Since(c.at) < ttl {
		value := c.value
		c.mu.Unlock()
		return value, nil
	}
	c.mu.Unlock()
	value, err := fn(ctx)
	if err != nil {
		return value, err
	}
	c.mu.Lock()
	c.value, c.at = value, time.Now()
	c.mu.Unlock()
	return value, nil
}

func (s *Service) Overview(ctx context.Context) (Overview, error) {
	return s.overviewCache.get(ctx, snapshotTTL, func(ctx context.Context) (Overview, error) {
		ctx, cancel := context.WithTimeout(ctx, queryTimeout)
		defer cancel()
		row, err := db.New(s.Pool).AdminStatsOverview(ctx)
		if err != nil {
			return Overview{}, err
		}
		return Overview{
			Users:        Counter{Total: row.TotalUsers, New1d: row.NewUsers1d, New7d: row.NewUsers7d, New30d: row.NewUsers30d},
			Workspaces:   Counter{Total: row.TotalWorkspaces, New1d: row.NewWorkspaces1d, New7d: row.NewWorkspaces7d, New30d: row.NewWorkspaces30d},
			Members:      row.TotalMembers,
			ActiveUsers:  ActiveWindow{Day: row.ActiveUsers1d, Week: row.ActiveUsers7d, Month: row.ActiveUsers30d},
			ActiveDaemons: row.ActiveDaemons1d,
			PendingInvitations: row.PendingInvitations,
			GeneratedAt:  time.Now().UTC(),
		}, nil
	})
}

func (s *Service) Breakdown(ctx context.Context) (Breakdown, error) {
	return s.breakdownCache.get(ctx, snapshotTTL, func(ctx context.Context) (Breakdown, error) {
		ctx, cancel := context.WithTimeout(ctx, queryTimeout)
		defer cancel()
		q := db.New(s.Pool)
		invitations, err := q.AdminStatsInvitations(ctx)
		if err != nil {
			return Breakdown{}, err
		}
		roles, err := q.AdminStatsMemberRoles(ctx)
		if err != nil {
			return Breakdown{}, err
		}
		sizes, err := q.AdminStatsWorkspaceSizes(ctx)
		if err != nil {
			return Breakdown{}, err
		}
		return Breakdown{
			Invitations:    ordered(invitationOrder, invitations, func(r db.AdminStatsInvitationsRow) (string, int64) { return r.Status, r.Value }),
			MemberRoles:    ordered(roleOrder, roles, func(r db.AdminStatsMemberRolesRow) (string, int64) { return r.Role, r.Value }),
			WorkspaceSizes: ordered(sizeOrder, sizes, func(r db.AdminStatsWorkspaceSizesRow) (string, int64) { return r.Bucket, r.Value }),
			GeneratedAt:    time.Now().UTC(),
		}, nil
	})
}

// ordered projects rows into CountEntry lists in a fixed key order so the
// client can index by position and always renders every expected row, even
// when a bucket is absent from the database.
func ordered[K any](keys []string, rows []K, pick func(K) (string, int64)) []CountEntry {
	counts := map[string]int64{}
	for _, row := range rows {
		key, value := pick(row)
		counts[key] = value
	}
	out := make([]CountEntry, 0, len(keys))
	for _, key := range keys {
		out = append(out, CountEntry{Key: key, Count: counts[key]})
	}
	return out
}

// Trends merges the three daily series (new users, new workspaces, DAU) into
// one per-day list. All series share the same generate_series day spine, so
// the merge is positional; any misalignment is a programming error and is
// reported rather than silently skewed.
func (s *Service) Trends(ctx context.Context, days int, tz string) (Trends, error) {
	if days <= 0 {
		days = defaultTrendDays
	}
	if days > maxTrendDays {
		return Trends{}, ErrInvalid
	}
	if tz == "" {
		tz = "UTC"
	}
	location, err := time.LoadLocation(tz)
	if err != nil {
		return Trends{}, ErrInvalid
	}
	// The since date is the first bucket: today in the viewing timezone minus
	// days-1. pgtype.Date carries the pure calendar date; the timezone only
	// decides which wall-clock day "now" falls into.
	now := time.Now().In(location)
	since := now.AddDate(0, 0, -(days - 1))
	sinceDate := pgtype.Date{Time: time.Date(since.Year(), since.Month(), since.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
	params := db.AdminStatsUserTrendParams{Tz: location.String(), Since: sinceDate}

	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	q := db.New(s.Pool)
	users, err := q.AdminStatsUserTrend(ctx, params)
	if err != nil {
		return Trends{}, err
	}
	workspaces, err := q.AdminStatsWorkspaceTrend(ctx, db.AdminStatsWorkspaceTrendParams{Tz: params.Tz, Since: params.Since})
	if err != nil {
		return Trends{}, err
	}
	dau, err := q.AdminStatsDauTrend(ctx, db.AdminStatsDauTrendParams{Tz: params.Tz, Since: params.Since})
	if err != nil {
		return Trends{}, err
	}
	// The day spine is authoritative from SQL (a request straddling a tz
	// midnight may return one more bucket than Go computed); the three
	// series must merely agree with each other.
	if len(users) != len(workspaces) || len(users) != len(dau) {
		return Trends{}, fmt.Errorf("admin stats trend series misaligned: users=%d workspaces=%d dau=%d", len(users), len(workspaces), len(dau))
	}
	series := make([]TrendPoint, 0, len(users))
	for i := range users {
		if !users[i].Day.Valid || users[i].Day.Time != workspaces[i].Day.Time || users[i].Day.Time != dau[i].Day.Time {
			return Trends{}, fmt.Errorf("admin stats trend day mismatch at index %d", i)
		}
		series = append(series, TrendPoint{
			Date:               users[i].Day.Time.Format("2006-01-02"),
			NewUsers:           users[i].Value,
			NewWorkspaces:      workspaces[i].Value,
			ActiveUsers:        dau[i].Total,
			ActiveUsersWeb:     dau[i].Web,
			ActiveUsersDesktop: dau[i].Desktop,
		})
	}
	return Trends{Tz: location.String(), Days: days, Series: series}, nil
}
