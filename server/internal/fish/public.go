package fish

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"github.com/auro-ai/auro/server/internal/util"
	db "github.com/auro-ai/auro/server/pkg/db/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"net/url"
	"strings"
)

// PublicOceanID identifies the shared scene. Publication provenance stays workspace-scoped.
const PublicOceanID = "a429ac92-8e79-4bee-b88d-5cc4f637e187"
const publicPageSize = 40

type PublishedFish struct {
	ID              string `json:"id"`
	OwnerID         string `json:"ownerId"`
	Revision        int    `json:"revision"`
	ContentHash     string `json:"contentHash"`
	CompilerVersion int    `json:"compilerVersion"`
	RulesVersion    int    `json:"rulesVersion"`
	Draft           Draft  `json:"draft"`
}
type PublicResident struct {
	ID        string        `json:"id"`
	OceanID   string        `json:"oceanId"`
	Revision  int           `json:"revision"`
	Seed      int           `json:"seed"`
	CanManage bool          `json:"canManage"`
	Fish      PublishedFish `json:"fish"`
}
type PublicOcean struct {
	ID         string           `json:"id"`
	Total      int              `json:"total"`
	Residents  []PublicResident `json:"residents"`
	Focus      *PublicResident  `json:"focus,omitempty"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

func publicResident(row db.FishPublication, a Actor) (PublicResident, error) {
	var snapshot Resident
	if err := json.Unmarshal(row.Payload, &snapshot); err != nil {
		return PublicResident{}, err
	}
	c := snapshot.Fish
	return PublicResident{
		ID: snapshot.ID, OceanID: PublicOceanID, Revision: snapshot.Revision, Seed: snapshot.Seed,
		CanManage: util.UUIDToString(row.UserID) == a.UserID,
		Fish:      PublishedFish{ID: c.ID, OwnerID: c.OwnerID, Revision: c.Revision, ContentHash: c.ContentHash, CompilerVersion: c.CompilerVersion, RulesVersion: c.RulesVersion, Draft: c.Draft},
	}, nil
}

func (s *Service) PublicOcean(ctx context.Context, a Actor, cursor, residentID, fishID string) (PublicOcean, error) {
	out := PublicOcean{ID: PublicOceanID, Residents: []PublicResident{}}
	w, u, err := scope(a)
	if err != nil {
		return out, err
	}
	var member bool
	if err = s.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM member WHERE workspace_id=$1 AND user_id=$2)", w, u).Scan(&member); err != nil {
		return out, err
	}
	if !member {
		return out, problem("workspace_forbidden", 403)
	}
	if residentID != "" && fishID != "" {
		return out, problem("invalid_request", 400)
	}
	after := pgtype.UUID{Valid: true}
	if cursor != "" {
		after, err = inputUUID(cursor)
		if err != nil {
			return out, err
		}
	}
	q := db.New(s.Pool)
	rows, err := q.ListPublicFish(ctx, after)
	if err != nil {
		return out, err
	}
	if len(rows) > publicPageSize {
		out.NextCursor = util.UUIDToString(rows[publicPageSize-1].ID)
		rows = rows[:publicPageSize]
	}
	for _, row := range rows {
		resident, err := publicResident(row, a)
		if err != nil {
			return out, err
		}
		out.Residents = append(out.Residents, resident)
	}
	count, err := q.CountPublicFish(ctx)
	if err != nil {
		return out, err
	}
	out.Total = int(count)
	if residentID != "" || fishID != "" {
		value := residentID
		if fishID != "" {
			value = fishID
		}
		id, err := inputUUID(value)
		if err != nil {
			return out, err
		}
		var row db.FishPublication
		if fishID != "" {
			row, err = q.GetPublicFishBySource(ctx, id)
		} else {
			row, err = q.GetPublicFish(ctx, id)
		}
		if errors.Is(err, pgx.ErrNoRows) {
			return out, nil
		}
		if err != nil {
			return out, err
		}
		focus, err := publicResident(row, a)
		if err != nil {
			return out, err
		}
		out.Focus = &focus
	}
	return out, nil
}

func (s *Service) publish(ctx context.Context, a Actor, in ReleaseInput, residentID string, expected int) (ReleaseResult, error) {
	var out ReleaseResult
	if in.Revision < 1 || in.Revision > Rules.MaxRevisions {
		return out, problem("invalid_request", 400)
	}
	op := "release"
	if residentID != "" {
		op = "apply"
	}
	intent := struct {
		ReleaseInput
		ResidentID string `json:"residentId"`
		Expected   int    `json:"expectedResidentRevision"`
	}{in, residentID, expected}
	raw, err := s.write(ctx, a, op, in.RequestID, intent, func(q *db.Queries, w, u pgtype.UUID) (any, error) {
		current, err := readCharacter(ctx, q, w, u, in.FishID, 0)
		if err != nil {
			return nil, err
		}
		if current.Archived {
			return nil, problem("fish_archived", 409)
		}
		fish, err := readCharacter(ctx, q, w, u, in.FishID, in.Revision)
		if err != nil {
			return nil, err
		}
		if fish.CompilerVersion != 1 || fish.RulesVersion != 1 || !Validate(fish.Draft).Valid {
			return nil, problem("fish_incompatible", 409)
		}
		if fish.ContentHash != in.ContentHash {
			return nil, problem("fish_hash_mismatch", 409)
		}
		fid, err := inputUUID(fish.ID)
		if err != nil {
			return nil, err
		}
		old, err := q.FindMyPublicFish(ctx, db.FindMyPublicFishParams{WorkspaceID: w, UserID: u, FishID: fid})
		exists := err == nil
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		seedBytes := uuid.New()
		id, revision, seed := uuid.NewString(), 1, int(binary.BigEndian.Uint32(seedBytes[:4])&0x7fffffff)
		if exists {
			var previous Resident
			if err := json.Unmarshal(old.Payload, &previous); err != nil {
				return nil, err
			}
			id, revision, seed = util.UUIDToString(old.ID), int(old.Revision)+1, previous.Seed
		}
		if op == "apply" {
			if !exists || !old.Active || id != residentID {
				return nil, problem("not_found", 404)
			}
			if int(old.Revision) != expected {
				return nil, problem("resident_revision_conflict", 409)
			}
		} else {
			if exists && old.Active {
				return nil, problem("already_released", 409)
			}
			count, err := q.CountMyPublicFish(ctx, db.CountMyPublicFishParams{WorkspaceID: w, UserID: u})
			if err != nil {
				return nil, err
			}
			if count >= int64(Rules.Capacity) {
				return nil, problem("capacity_reached", 429)
			}
		}
		if revision > 10000 {
			return nil, problem("revision_limit", 409)
		}
		snapshot := Resident{ID: id, OceanID: PublicOceanID, Revision: revision, Seed: seed, Fish: fish}
		payload, err := json.Marshal(snapshot)
		if err != nil {
			return nil, err
		}
		rid, err := inputUUID(id)
		if err != nil {
			return nil, err
		}
		if err := q.PutPublicFish(ctx, db.PutPublicFishParams{ID: rid, WorkspaceID: w, UserID: u, FishID: fid, Revision: int32(revision), Payload: payload}); err != nil {
			return nil, err
		}
		path := "/ocean?resident=" + url.QueryEscape(id)
		return ReleaseResult{Resident: snapshot, OceanURL: strings.TrimRight(s.AppURL, "/") + path}, nil
	})
	if err == nil {
		err = json.Unmarshal(raw, &out)
	}
	return out, err
}
func (s *Service) recallPublic(ctx context.Context, a Actor, in RecallInput) (json.RawMessage, error) {
	id, err := inputUUID(in.ResidentID)
	if err != nil {
		return nil, err
	}
	if in.ExpectedResidentRevision < 1 {
		return nil, problem("invalid_request", 400)
	}
	return s.write(ctx, a, "recall", in.RequestID, in, func(q *db.Queries, _, u pgtype.UUID) (any, error) {
		count, err := q.RecallPublicFish(ctx, db.RecallPublicFishParams{UserID: u, ID: id, Revision: int32(in.ExpectedResidentRevision)})
		if err != nil {
			return nil, err
		}
		if count != 1 {
			return nil, problem("resident_revision_conflict", 409)
		}
		return map[string]any{"recalled": true, "residentId": in.ResidentID}, nil
	})
}
