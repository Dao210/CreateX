package deal

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/auro-ai/auro/server/internal/util"
	"golang.org/x/sys/unix"
)

type Store struct {
	dir      string
	lockFile *os.File
	createMu sync.Mutex
	locks    sync.Map
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(filepath.Join(dir, ".lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		_ = f.Close()
		return nil, fmt.Errorf("DEAL data directory already in use: %w", err)
	}
	return &Store{dir: dir, lockFile: f}, nil
}

func (s *Store) Close() error { return s.lockFile.Close() }
func (s *Store) sessionLock(id string) *sync.Mutex {
	v, _ := s.locks.LoadOrStore(id, &sync.Mutex{})
	return v.(*sync.Mutex)
}
func (s *Store) load(id string) (*Session, error) {
	if _, err := util.ParseUUID(id); err != nil {
		return nil, problem("not_found", 404)
	}
	data, err := os.ReadFile(filepath.Join(s.dir, id+".json"))
	if os.IsNotExist(err) {
		return nil, problem("not_found", 404)
	}
	if err != nil {
		return nil, err
	}
	var game Session
	if err = json.Unmarshal(data, &game); err != nil {
		return nil, err
	}
	if game.ScenarioVersion != ScenarioVersion || game.RulesVersion != RulesVersion {
		return nil, problem("unsupported_session", 409)
	}
	return &game, nil
}

func (s *Store) save(game *Session) error {
	data, err := json.Marshal(game)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(s.dir, ".pending-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Sync(); err != nil {
		_ = f.Close()
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(name, filepath.Join(s.dir, game.ID+".json")); err != nil {
		return err
	}
	// Rename is the commit point. A response loss after this point is recovered by receipts.
	if dir, openErr := os.Open(s.dir); openErr == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

func (s *Store) create(game *Session) error {
	s.createMu.Lock()
	defer s.createMu.Unlock()
	files, err := filepath.Glob(filepath.Join(s.dir, "*.json"))
	if err != nil {
		return err
	}
	if len(files) >= 500 {
		return problem("capacity_reached", 429)
	}
	return s.save(game)
}

func copySession(game *Session) (*Session, error) {
	data, err := json.Marshal(game)
	if err != nil {
		return nil, err
	}
	var next Session
	if err = json.Unmarshal(data, &next); err != nil {
		return nil, err
	}
	return &next, nil
}
