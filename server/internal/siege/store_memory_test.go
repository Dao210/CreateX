package siege

import (
	"encoding/json"
	"sync"
	"time"
)

// testStore exercises service behavior without another runtime persistence mode.
type testStore struct {
	mu        sync.Mutex
	sessions  map[string]*Session
	budgets   map[string]int
	locks     sessionLocks
	saveError error
}

func newTestStore() *testStore {
	return &testStore{sessions: map[string]*Session{}, budgets: map[string]int{}}
}
func (s *testStore) Close() error { return nil }
func cloneSession(session *Session) *Session {
	data, _ := json.Marshal(session)
	var copy Session
	_ = json.Unmarshal(data, &copy)
	return &copy
}
func (s *testStore) CreateSession(owner Owner, request string, build func() *Session) (*Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for _, session := range s.sessions {
		if session.OwnerHash != owner.Hash() {
			continue
		}
		if session.CreateRequest == request {
			return cloneSession(session), nil
		}
		count++
	}
	if count >= maxSessionsPerOwner {
		return nil, problem("capacity_reached", 429)
	}
	session := build()
	s.sessions[session.ID] = cloneSession(session)
	return session, nil
}
func (s *testStore) ReadSession(id string, owner Owner) (*Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	session := s.sessions[id]
	if session == nil || session.OwnerHash != owner.Hash() {
		return nil, problem("not_found", 404)
	}
	return cloneSession(session), nil
}
func (s *testStore) ListSessions(owner Owner) ([]*Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*Session, 0)
	for _, session := range s.sessions {
		if session.OwnerHash == owner.Hash() {
			out = append(out, cloneSession(session))
		}
	}
	return out, nil
}
func (s *testStore) SaveSession(session *Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.saveError != nil {
		return s.saveError
	}
	s.sessions[session.ID] = cloneSession(session)
	return nil
}
func (s *testStore) LockSession(id string, owner Owner) (*Session, func(), error) {
	lock := s.locks.get(id)
	if !lock.TryLock() {
		return nil, nil, problem("service_busy", 429)
	}
	session, err := s.ReadSession(id, owner)
	if err != nil {
		lock.Unlock()
		return nil, nil, err
	}
	return session, lock.Unlock, nil
}
func (s *testStore) ReserveBudget(owner Owner, limit int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	key := owner.Hash() + time.Now().UTC().Format("2006-01-02")
	if s.budgets[key] >= limit {
		return problem("recognition_budget", 429)
	}
	s.budgets[key]++
	return nil
}

// sessionLocks hands out one mutex per session id. Test stores use it for local exclusion; PostgreSQL uses advisory locks across processes.
type sessionLocks struct{ locks sync.Map }

func (l *sessionLocks) get(id string) *sync.Mutex {
	v, _ := l.locks.LoadOrStore(id, &sync.Mutex{})
	return v.(*sync.Mutex)
}
