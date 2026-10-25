package siege

import "sync"

// Owner identifies who a session belongs to. Before the Auro integration this
// was an anonymous siege_owner cookie; it is now the workspace member making
// the request, so cross-device access works and leaving a workspace revokes
// access to its blueprints.
type Owner struct {
	WorkspaceID string
	UserID      string
}

// Hash is the stable key written into Session.OwnerHash. Sessions persist this
// instead of the two UUIDs so the on-disk format of standalone mode is
// unchanged; the PostgreSQL store keeps the columns separately for querying.
//
// In standalone mode WorkspaceID is empty and the hash falls back to the
// pre-integration shape (a hash of the anonymous cookie), so existing
// .siege/sessions documents stay readable.
func (o Owner) Hash() string {
	if o.WorkspaceID == "" {
		return payloadHash(o.UserID)
	}
	return payloadHash(o.WorkspaceID + "|" + o.UserID)
}

// Store is the persistence backend for siege sessions.
//
// The file implementation backs standalone mode (`cmd/siege`, fixture demos,
// Playwright); the PostgreSQL implementation backs the workspace-scoped routes
// mounted on the main server. Both must preserve the same concurrency contract:
// CreateSession is idempotent per (owner, requestID) and LockSession is
// exclusive per session.
type Store interface {
	// Close releases the backend. Safe to call once.
	Close() error
	// CreateSession creates a session, or returns the existing one when the
	// same owner already used this requestID. Returns capacity_reached when the
	// total or per-owner session budget is exhausted.
	CreateSession(owner Owner, requestID string, build func() *Session) (*Session, error)
	// ReadSession reads without taking the session lock. Returns not_found when
	// the session does not exist or belongs to someone else.
	ReadSession(id string, owner Owner) (*Session, error)
	// LockSession takes the session-level exclusive lock and reads the session.
	// Returns service_busy when another request holds it, not_found when the
	// session does not exist or belongs to someone else. release must be called
	// by the same goroutine that acquired the lock.
	LockSession(id string, owner Owner) (session *Session, release func(), err error)
	// SaveSession persists the whole session document. The caller must hold the
	// lock from LockSession.
	SaveSession(session *Session) error
	// ReserveBudget consumes one daily recognition slot for this owner. Returns
	// recognition_budget when the limit is reached.
	ReserveBudget(owner Owner, limit int) error
}

const (
	// maxSessionsTotal bounds the store as a whole so a single deployment
	// cannot grow without limit.
	maxSessionsTotal = 500
	// maxSessionsPerOwner bounds one member. Five is the pre-integration
	// per-cookie value; keep it so nobody who had access loses a slot.
	maxSessionsPerOwner = 5
)

// sessionLocks hands out one mutex per session id. Both stores use it for the
// in-process half of LockSession; PostgreSQL additionally takes an advisory
// lock so multiple server processes exclude each other.
type sessionLocks struct{ locks sync.Map }

func (l *sessionLocks) get(id string) *sync.Mutex {
	v, _ := l.locks.LoadOrStore(id, &sync.Mutex{})
	return v.(*sync.Mutex)
}
