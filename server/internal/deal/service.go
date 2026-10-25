package deal

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/auro-ai/auro/server/internal/util"
	"github.com/google/uuid"
)

type Service struct {
	Store *Store
	Model Model
	Mode  string
	Ready bool
}

func ownerHash(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}
func owns(game *Session, token string) bool {
	return subtle.ConstantTimeCompare([]byte(game.OwnerHash), []byte(ownerHash(token))) == 1
}

func (s *Service) Create(owner string) (PublicSession, error) {
	if !s.Ready {
		return PublicSession{}, problem("model_not_configured", 503)
	}
	game := NewSession(uuid.NewString(), ownerHash(owner))
	if err := s.Store.create(game); err != nil {
		return PublicSession{}, err
	}
	return game.Public(), nil
}

func (s *Service) Read(id, owner string) (PublicSession, error) {
	game, err := s.Store.load(id)
	if err != nil {
		return PublicSession{}, err
	}
	if !owns(game, owner) {
		return PublicSession{}, problem("not_found", 404)
	}
	return game.Public(), nil
}

func validateInput(in Input) error {
	if _, err := util.ParseUUID(in.RequestID); err != nil || in.ExpectedVersion < 1 {
		return problem("invalid_input", 400)
	}
	switch in.Kind {
	case "talk":
		if strings.TrimSpace(in.Text) == "" || !utf8.ValidString(in.Text) || utf8.RuneCountInString(in.Text) > 1200 || in.ItemID != "" || in.Action != "" {
			return problem("invalid_input", 400)
		}
	case "item":
		if in.ItemID == "" || !oneOf(in.Action, "inspect", "show", "give", "backup") || in.Text != "" {
			return problem("invalid_input", 400)
		}
	case "wait":
		if in.ItemID != "" || in.Action != "" || in.Text != "" {
			return problem("invalid_input", 400)
		}
	default:
		return problem("invalid_input", 400)
	}
	return nil
}

func (s *Service) Turn(ctx context.Context, id, owner string, in Input) (PublicSession, error) {
	if err := validateInput(in); err != nil {
		return PublicSession{}, err
	}
	// Authenticate before allocating a lock, so arbitrary IDs cannot grow the lock map.
	game, err := s.Store.load(id)
	if err != nil {
		return PublicSession{}, err
	}
	if !owns(game, owner) {
		return PublicSession{}, problem("not_found", 404)
	}
	lock := s.Store.sessionLock(id)
	lock.Lock()
	defer lock.Unlock()
	game, err = s.Store.load(id)
	if err != nil {
		return PublicSession{}, err
	}
	for _, r := range game.Receipts {
		if r.Input.RequestID == in.RequestID {
			if r.Input != in {
				return PublicSession{}, problem("request_id_reused", 409)
			}
			return game.Public(), nil
		}
	}
	if in.ExpectedVersion != game.Version {
		return PublicSession{}, problem("version_conflict", 409)
	}
	if !s.Ready {
		return PublicSession{}, problem("model_not_configured", 503)
	}
	if game.Ending != "" {
		return PublicSession{}, problem("session_ended", 409)
	}
	next, err := copySession(game)
	if err != nil {
		return PublicSession{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	meaning := Interpretation{Act: "assert", Topic: "other", Proposal: "none", Claims: []Assertion{}}
	if in.Kind == "talk" {
		if next.MarcoAway {
			return PublicSession{}, problem("marco_away", 409)
		}
		meaning, err = s.Model.Interpret(ctx, in.Text, game.Public())
		if err != nil {
			return PublicSession{}, problem("model_unavailable", 502)
		}
		if err = validateInterpretation(meaning, in.Text); err != nil {
			return PublicSession{}, problem("model_invalid_response", 502)
		}
	}
	performance, discoveries, err := Apply(next, in, meaning)
	if err != nil {
		return PublicSession{}, err
	}
	line := performance.Lines[0].Text
	if in.Kind == "talk" {
		line, err = s.Model.ChooseLine(ctx, in.Text, performance.Lines)
		if err != nil {
			return PublicSession{}, problem("model_unavailable", 502)
		}
	}
	allowed := false
	for _, l := range performance.Lines {
		if l.Text == line {
			allowed = true
		}
	}
	if !allowed {
		return PublicSession{}, problem("model_invalid_response", 502)
	}
	player := in.Text
	if in.Kind == "item" {
		for _, obj := range objects {
			if obj.ID == in.ItemID {
				actions := map[string]string{"inspect": "查看", "show": "展示", "give": "交付", "backup": "备份账目到"}
				player = actions[in.Action] + " · " + obj.Name
			}
		}
	}
	if in.Kind == "wait" {
		player = "等 Marco 回来"
	}
	next.Version++
	next.Receipts = append(next.Receipts, Receipt{Input: in, Interpretation: meaning, Entry: Entry{Turn: len(next.Receipts) + 1, Player: player, Dialogue: line, Reaction: performance.Reaction, Pose: performance.Pose, Discoveries: discoveries, Action: performance.Action, TimeCost: game.Remaining - next.Remaining}})
	if err = ctx.Err(); err != nil {
		return PublicSession{}, problem("model_unavailable", 502)
	}
	if err = s.Store.save(next); err != nil {
		return PublicSession{}, err
	}
	return next.Public(), nil
}
