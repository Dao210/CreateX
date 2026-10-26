package siege

// Owner identifies the workspace member making the request.
type Owner struct {
	WorkspaceID string
	UserID      string
}

// Hash binds the persisted session document to the same scoped owner as its row.
func (o Owner) Hash() string { return payloadHash(o.WorkspaceID + "|" + o.UserID) }

// Store preserves idempotent creation and exclusive session writes.
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

const maxSessionsPerOwner = 5
