package siege

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/auro-ai/auro/server/internal/util"
	"golang.org/x/sys/unix"
)

// fileStore keeps one JSON document per session in a directory, guarded by a
// process-level flock so two instances cannot share the data directory.
//
// It backs standalone mode: `make up C=siege`, fixture recognition demos, and
// the Playwright suite, all of which run without PostgreSQL or Auro accounts.
type fileStore struct {
	dir    string
	lock   *os.File
	mu     sync.Mutex
	diskMu sync.Mutex
	locks  sessionLocks
}

// OpenStore opens (creating if needed) a file-backed store. The returned Store
// is safe for concurrent use within one process.
func OpenStore(dir string) (Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(filepath.Join(dir, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		return nil, errors.New("siege data directory already in use")
	}
	return &fileStore{dir: dir, lock: lock}, nil
}

func (s *fileStore) Close() error { return s.lock.Close() }

func (s *fileStore) load(id string, owner Owner) (*Session, error) {
	if _, err := util.ParseUUID(id); err != nil {
		return nil, problem("not_found", 404)
	}
	data, err := os.ReadFile(filepath.Join(s.dir, "session-"+id+".json"))
	if os.IsNotExist(err) {
		return nil, problem("not_found", 404)
	}
	if err != nil {
		return nil, err
	}
	var session Session
	if err = json.Unmarshal(data, &session); err != nil {
		return nil, err
	}
	if subtle.ConstantTimeCompare([]byte(session.OwnerHash), []byte(owner.Hash())) != 1 {
		return nil, problem("not_found", 404)
	}
	return &session, nil
}

func (s *fileStore) write(name string, value any) error {
	s.diskMu.Lock()
	defer s.diskMu.Unlock()
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(s.dir)
	if err != nil {
		return err
	}
	total := int64(len(data))
	for _, entry := range entries {
		if entry.IsDir() || entry.Name() == name || entry.Name() == ".lock" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
	}
	if len(data) > 16*1024*1024 || total > 128*1024*1024 {
		return problem("storage_capacity", 507)
	}
	f, err := os.CreateTemp(s.dir, ".pending-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), filepath.Join(s.dir, name)); err != nil {
		return err
	}
	dir, err := os.Open(s.dir)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func (s *fileStore) SaveSession(session *Session) error {
	return s.write("session-"+session.ID+".json", session)
}

func (s *fileStore) ReadSession(id string, owner Owner) (*Session, error) {
	return s.load(id, owner)
}

func (s *fileStore) CreateSession(owner Owner, requestID string, build func() *Session) (*Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	files, err := filepath.Glob(filepath.Join(s.dir, "session-*.json"))
	if err != nil {
		return nil, err
	}
	ownerCount := 0
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		var old Session
		if err = json.Unmarshal(data, &old); err != nil {
			return nil, err
		}
		if old.OwnerHash != owner.Hash() {
			continue
		}
		ownerCount++
		if old.CreateRequest == requestID {
			return &old, nil
		}
	}
	if len(files) >= maxSessionsTotal || ownerCount >= maxSessionsPerOwner {
		return nil, problem("capacity_reached", 429)
	}
	session := build()
	if err = s.SaveSession(session); err != nil {
		return nil, err
	}
	return session, nil
}

func (s *fileStore) LockSession(id string, owner Owner) (*Session, func(), error) {
	// Read first so a missing or foreign session never creates a lock entry.
	if _, err := s.load(id, owner); err != nil {
		return nil, nil, err
	}
	lock := s.locks.get(id)
	if !lock.TryLock() {
		return nil, nil, problem("service_busy", 429)
	}
	session, err := s.load(id, owner)
	if err != nil {
		lock.Unlock()
		return nil, nil, err
	}
	return session, lock.Unlock, nil
}

func (s *fileStore) ReserveBudget(_ Owner, limit int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var budget struct {
		Day   string `json:"day"`
		Count int    `json:"count"`
	}
	data, err := os.ReadFile(filepath.Join(s.dir, "budget.json"))
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if len(data) > 0 {
		if err = json.Unmarshal(data, &budget); err != nil {
			return err
		}
	}
	day := time.Now().UTC().Format("2006-01-02")
	if budget.Day != day {
		budget.Day = day
		budget.Count = 0
	}
	if budget.Count >= limit {
		return problem("recognition_budget", 429)
	}
	budget.Count++
	return s.write("budget.json", budget)
}
