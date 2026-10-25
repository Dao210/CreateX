package siege

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/auro-ai/auro/server/internal/util"
	"github.com/google/uuid"
)

type Service struct {
	Store       Store
	Model       Recognizer
	Mode        string
	Ready       bool
	DailyBudget int
	slots       chan struct{}
}

func NewService(store Store, model Recognizer, mode string, ready bool, budget int) *Service {
	return &Service{Store: store, Model: model, Mode: mode, Ready: ready, DailyBudget: budget, slots: make(chan struct{}, 2)}
}
func validRequest(id string) bool { _, err := util.ParseUUID(id); return err == nil }

func (s *Service) Create(owner Owner, requestID string) (*Session, error) {
	if !validRequest(requestID) {
		return nil, problem("invalid_input", 400)
	}
	return s.Store.CreateSession(owner, requestID, func() *Session {
		return &Session{ID: uuid.NewString(), Version: 1, OwnerHash: owner.Hash(), CreateRequest: requestID,
			Blueprints: []Blueprint{}, RecognitionReceipts: []receipt{}, SaveReceipts: []saveReceipt{}}
	})
}

func (s *Service) Read(id string, owner Owner) (*Session, error) {
	return s.Store.ReadSession(id, owner)
}

func recoverReceipt(r receipt) Recognition {
	view := r.View
	if view.State == "processing" {
		view.State = "outcome_unknown"
		view.Code = "recognition_unknown"
	}
	return view
}

func (s *Service) Receipt(id string, owner Owner, requestID string) (Recognition, error) {
	session, release, err := s.Store.LockSession(id, owner)
	if err != nil {
		return Recognition{}, err
	}
	defer release()
	for _, r := range session.RecognitionReceipts {
		if r.View.RequestID == requestID {
			return recoverReceipt(r), nil
		}
	}
	return Recognition{}, problem("not_found", 404)
}

func (s *Service) Recognize(ctx context.Context, id string, owner Owner, requestID string, d Drawing) (Recognition, error) {
	if !validRequest(requestID) {
		return Recognition{}, problem("invalid_input", 400)
	}
	if err := validateDrawing(d); err != nil {
		return Recognition{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	session, release, err := s.Store.LockSession(id, owner)
	if err != nil {
		return Recognition{}, err
	}
	defer release()
	hash := drawingHash(d)
	for _, r := range session.RecognitionReceipts {
		if r.View.RequestID == requestID {
			if r.Hash != hash {
				return Recognition{}, problem("request_id_reused", 409)
			}
			return recoverReceipt(r), nil
		}
	}
	if !s.Ready || s.Model == nil {
		return Recognition{}, problem("model_not_configured", 503)
	}
	if len(session.RecognitionReceipts) >= 100 {
		return Recognition{}, problem("recognition_budget", 429)
	}
	select {
	case s.slots <- struct{}{}:
		defer func() { <-s.slots }()
	case <-ctx.Done():
		return Recognition{}, problem("service_busy", 429)
	}
	if err = ctx.Err(); err != nil {
		return Recognition{}, problem("service_busy", 429)
	}
	if err = s.Store.ReserveBudget(owner, s.DailyBudget); err != nil {
		return Recognition{}, err
	}
	view := Recognition{RequestID: requestID, DrawingHash: hash, State: "processing", Source: s.Mode}
	session.RecognitionReceipts = append(session.RecognitionReceipts, receipt{View: view, Hash: hash, CreatedAt: time.Now().Unix()})
	if err = s.Store.SaveSession(session); err != nil {
		return Recognition{}, err
	}
	spec, input, output, err := s.Model.Recognize(ctx, d)
	if err == nil {
		err = validateSpec(d, spec)
	}
	if err == nil && ctx.Err() != nil {
		err = ctx.Err()
	}
	if err != nil {
		view.State = "outcome_unknown"
		view.Code = "model_unavailable"
		var p *Problem
		if errors.As(err, &p) {
			view.State = "failed"
			view.Code = p.Code
		}
	} else {
		view.State = "complete"
		view.Spec = &spec
	}
	index := len(session.RecognitionReceipts) - 1
	session.RecognitionReceipts[index].View = view
	session.RecognitionReceipts[index].InputTokens = input
	session.RecognitionReceipts[index].OutputTokens = output
	if err = s.Store.SaveSession(session); err != nil {
		return Recognition{}, err
	}
	return view, nil
}

type SaveInput struct {
	RequestID       string        `json:"requestId"`
	ExpectedVersion int           `json:"expectedVersion"`
	Name            string        `json:"name"`
	Drawing         Drawing       `json:"drawing"`
	Spec            Spec          `json:"spec"`
	CannonDesign    *CannonDesign `json:"cannonDesign,omitempty"`
}

func (s *Service) Save(id string, owner Owner, in SaveInput) (*Session, error) {
	if !validRequest(in.RequestID) || in.ExpectedVersion < 1 || !utf8.ValidString(in.Name) || utf8.RuneCountInString(in.Name) > 80 || strings.TrimSpace(in.Name) == "" {
		return nil, problem("invalid_input", 400)
	}
	if err := validateDrawing(in.Drawing); err != nil {
		return nil, err
	}
	if err := validateSpec(in.Drawing, in.Spec); err != nil {
		return nil, err
	}
	if err := validateCannonDesign(in.CannonDesign, in.Drawing, in.Spec); err != nil {
		return nil, err
	}
	session, release, err := s.Store.LockSession(id, owner)
	if err != nil {
		return nil, err
	}
	defer release()
	hash := payloadHash(in)
	for _, r := range session.SaveReceipts {
		if r.RequestID == in.RequestID {
			if r.Hash != hash {
				return nil, problem("request_id_reused", 409)
			}
			return session, nil
		}
	}
	if session.Version != in.ExpectedVersion {
		return nil, problem("version_conflict", 409)
	}
	if len(session.Blueprints) >= 10 {
		return nil, problem("capacity_reached", 429)
	}
	session.Blueprints = append(session.Blueprints, Blueprint{ID: uuid.NewString(), Name: in.Name, Drawing: in.Drawing, Spec: in.Spec, CannonDesign: in.CannonDesign, RulesVersion: RulesVersion, CreatedAt: time.Now().UTC().Format(time.RFC3339)})
	session.Version++
	session.SaveReceipts = append(session.SaveReceipts, saveReceipt{in.RequestID, hash})
	if err = s.Store.SaveSession(session); err != nil {
		return nil, err
	}
	return session, nil
}
