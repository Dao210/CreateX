package reach

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

// Store owns the on-disk world. A reach world is a single-instance deployment:
// the file lock makes two processes fighting over the same directory fail fast
// instead of silently forking the simulation.
type Store struct {
	dir  string
	lock *os.File
	mu   sync.Mutex
}

func OpenStore(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	lock, err := os.OpenFile(filepath.Join(dir, ".lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(lock.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		lock.Close()
		return nil, errors.New("reach: world directory is already in use")
	}
	return &Store{dir: dir, lock: lock}, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.lock == nil {
		return nil
	}
	err := s.lock.Close()
	s.lock = nil
	return err
}

// worldFile is the persisted shape. It exists because World holds an index and a
// digest that must be rebuilt on load, not trusted from disk.
type worldFile struct {
	SeasonID       string              `json:"seasonId"`
	Seed           uint64              `json:"seed"`
	Beat           int64               `json:"beat"`
	Version        int64               `json:"version"`
	Entities       []*Entity           `json:"entities"`
	Wrecks         []*Wreck            `json:"wrecks"`
	Supplies       []*Supply           `json:"supplies"`
	Rifts          [2]int64            `json:"rifts"`
	Chronicle      []Chronicle         `json:"chronicle"`
	PowerSamples   []int64             `json:"powerSamples"`
	Seq            int64               `json:"seq"`
	FirstBloodDone bool                `json:"firstBloodDone"`
	Receipts       map[string]*Receipt `json:"receipts"`
	Fingerprints   map[string]string   `json:"fingerprints"`
	SavedAt        time.Time           `json:"savedAt"`
}

func (s *Store) path() string { return filepath.Join(s.dir, "world.json") }

// Load restores a season, or seeds a new one when the directory is empty. The
// seed is persisted so a restart continues the same world instead of quietly
// starting a different one.
func (s *Store) Load(seasonID string, seed uint64) (*World, map[string]*Receipt, map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path())
	if errors.Is(err, os.ErrNotExist) {
		w := NewWorld(seasonID, seed)
		return w, map[string]*Receipt{}, map[string]string{}, nil
	}
	if err != nil {
		return nil, nil, nil, err
	}
	var file worldFile
	if err = json.Unmarshal(data, &file); err != nil {
		return nil, nil, nil, fmt.Errorf("reach: corrupt world file: %w", err)
	}
	if file.SeasonID == "" {
		return nil, nil, nil, errors.New("reach: world file has no season")
	}

	w := &World{
		SeasonID:       file.SeasonID,
		Seed:           file.Seed,
		Beat:           file.Beat,
		Version:        file.Version,
		Entities:       file.Entities,
		Wrecks:         file.Wrecks,
		Supplies:       file.Supplies,
		Rifts:          file.Rifts,
		Chronicle:      file.Chronicle,
		PowerSamples:   file.PowerSamples,
		seq:            file.Seq,
		firstBloodDone: file.FirstBloodDone,
		byID:           make(map[string]*Entity, len(file.Entities)),
	}
	for _, e := range file.Entities {
		w.byID[e.ID] = e
	}
	w.digestValue = w.computeDigest()
	receipts := file.Receipts
	if receipts == nil {
		receipts = map[string]*Receipt{}
	}
	fingerprints := file.Fingerprints
	if fingerprints == nil {
		fingerprints = map[string]string{}
	}
	return w, receipts, fingerprints, nil
}

// Save writes atomically: a reader never sees a half-written world.
func (s *Store) Save(w *World, receipts map[string]*Receipt, fingerprints map[string]string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	file := worldFile{
		SeasonID:       w.SeasonID,
		Seed:           w.Seed,
		Beat:           w.Beat,
		Version:        w.Version,
		Entities:       w.Entities,
		Wrecks:         w.Wrecks,
		Supplies:       w.Supplies,
		Rifts:          w.Rifts,
		Chronicle:      w.Chronicle,
		PowerSamples:   w.PowerSamples,
		Seq:            w.seq,
		FirstBloodDone: w.firstBloodDone,
		Receipts:       receipts,
		Fingerprints:   fingerprints,
		SavedAt:        time.Now().UTC(),
	}
	data, err := json.Marshal(file)
	if err != nil {
		return err
	}
	tmp := s.path() + ".tmp"
	if err = os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path())
}

// SeasonID formats the current week as the season identifier. Weeks start on
// Monday so a season boundary never lands mid-weekend.
func SeasonID(t time.Time) string {
	year, week := t.UTC().ISOWeek()
	return fmt.Sprintf("%d-S%02d", year, week)
}
