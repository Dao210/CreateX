package reach

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const ownerCookie = "reach_owner"

// HTTP is the public surface. Everything an external agent needs is discoverable
// from one well-known document: no SDK, no per-tool adapter.
type HTTP struct {
	Service       *Service
	SecureCookies bool
	// SubmitPerHour is the anonymous write quota per IP. It is deliberately low:
	// the world is not a free compute pool.
	SubmitPerHour int
	// SnapshotLimit caps the default state payload. Larger views are reserved for
	// authenticated creators.
	SnapshotLimit int

	mu      sync.Mutex
	windows map[string]submitWindow
}

type submitWindow struct {
	Start time.Time
	Count int
}

func (h *HTTP) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /.well-known/reach.json", h.wellKnown)
	mux.HandleFunc("GET /api/reach/schema/entity-1.json", h.schema)
	mux.HandleFunc("GET /api/reach/state", h.state)
	mux.HandleFunc("GET /api/reach/feed", h.feed)
	mux.HandleFunc("GET /api/reach/season/current", h.season)
	mux.HandleFunc("POST /api/reach/entities", h.submit)
	mux.HandleFunc("GET /api/reach/entities/{id}", h.entity)
	mux.HandleFunc("POST /api/reach/entities/{id}/orders", h.order)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if r.Method == http.MethodPost {
			media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if err != nil || media != "application/json" {
				fail(w, problem("invalid_input", 415))
				return
			}
			if origin := r.Header.Get("Origin"); origin != "" {
				u, err := url.Parse(origin)
				scheme := "http"
				if h.SecureCookies || r.TLS != nil {
					scheme = "https"
				}
				if err != nil || u.Scheme != scheme || !strings.EqualFold(u.Host, r.Host) {
					fail(w, problem("invalid_origin", 403))
					return
				}
			}
			if !h.allow(r) {
				fail(w, problem("rate_limited", 429))
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

func (h *HTTP) allow(r *http.Request) bool {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	limit := h.SubmitPerHour
	if limit <= 0 {
		limit = 10
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	if h.windows == nil {
		h.windows = map[string]submitWindow{}
	}
	now := time.Now()
	for key, v := range h.windows {
		if now.Sub(v.Start) > time.Hour {
			delete(h.windows, key)
		}
	}
	v := h.windows[ip]
	if v.Start.IsZero() {
		if len(h.windows) >= 8192 {
			return false
		}
		v.Start = now
	}
	if v.Count >= limit {
		return false
	}
	v.Count++
	h.windows[ip] = v
	return true
}

func (h *HTTP) wellKnown(w http.ResponseWriter, r *http.Request) {
	season := h.Service.Season()
	respond(w, 200, map[string]any{
		"world":        "reach",
		"season":       season.ID,
		"beat":         season.Beat,
		"rulesVersion": RulesVersion,
		"schemas":      map[string]string{"entity": "/api/reach/schema/entity-1.json"},
		"endpoints": map[string]string{
			"state":  "/api/reach/state",
			"feed":   "/api/reach/feed",
			"submit": "/api/reach/entities",
			"entity": "/api/reach/entities/{id}",
			"season": "/api/reach/season/current",
		},
		"limits": map[string]any{
			"entitiesPerHour": h.SubmitPerHour,
			"payloadBytes":    16384,
			"ordersPerSeason": 3,
		},
		"docs": "/developers/reach",
	})
}

func (h *HTTP) schema(w http.ResponseWriter, r *http.Request) {
	data, err := EntitySchemaJSON()
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.WriteHeader(200)
	w.Write(data)
}

func (h *HTTP) state(w http.ResponseWriter, r *http.Request) {
	season := h.Service.Season()
	etag := `W/"` + seasonDigest(season) + `"`
	if match := r.Header.Get("If-None-Match"); match != "" && match == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	snap := h.Service.Snapshot()
	limit := h.SnapshotLimit
	if limit <= 0 {
		limit = 600
	}
	if len(snap.Entities) > limit {
		// Keep the board first, then fill the map with whoever is still alive, so
		// the viewer always sees both the leaders and a populated world.
		keep := make(map[string]bool, limit)
		for _, e := range h.Service.Top(limit / 2) {
			keep[e.ID] = true
		}
		filtered := make([]EntityView, 0, limit)
		for _, view := range snap.Entities {
			if keep[view.ID] && len(filtered) < limit {
				filtered = append(filtered, view)
			}
		}
		for _, view := range snap.Entities {
			if len(filtered) >= limit {
				break
			}
			if view.Status == StatusAlive && !keep[view.ID] {
				filtered = append(filtered, view)
			}
		}
		snap.Entities = filtered
	}
	w.Header().Set("ETag", etag)
	respond(w, 200, snap)
}

func seasonDigest(s SeasonInfo) string {
	return s.ID + "-" + strconv.FormatInt(s.Beat, 10) + "-" + strconv.Itoa(s.Entities)
}

func (h *HTTP) feed(w http.ResponseWriter, r *http.Request) {
	since := int64(0)
	if raw := r.URL.Query().Get("since"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			fail(w, problem("invalid_cursor", 400))
			return
		}
		since = parsed
	}
	limit := 50
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if parsed, err := strconv.ParseInt(raw, 10, 64); err == nil {
			limit = int(parsed)
		}
	}
	events, cursor := h.Service.Feed(since, limit)
	respond(w, 200, map[string]any{"cursor": cursor, "events": events})
}

func (h *HTTP) season(w http.ResponseWriter, r *http.Request) {
	respond(w, 200, h.Service.Season())
}

func (h *HTTP) submit(w http.ResponseWriter, r *http.Request) {
	var spec Spec
	if err := readBody(w, r, &spec); err != nil {
		fail(w, err)
		return
	}
	key := r.Header.Get("Idempotency-Key")
	token := owner(r)
	fresh := token == ""
	if fresh {
		bytes := make([]byte, 32)
		if _, err := rand.Read(bytes); err != nil {
			fail(w, err)
			return
		}
		token = hex.EncodeToString(bytes)
	}

	receipt, err := h.Service.Submit(Submit{
		Spec:           spec,
		IdempotencyKey: key,
		OwnerHash:      payloadHash(token),
	})
	if err != nil {
		fail(w, err)
		return
	}
	if fresh {
		http.SetCookie(w, &http.Cookie{
			Name: ownerCookie, Value: token, Path: "/api/reach",
			HttpOnly: true, SameSite: http.SameSiteLaxMode,
			Secure: h.SecureCookies || r.TLS != nil, MaxAge: 30 * 86400,
		})
	}
	respond(w, 201, receipt)
}

func (h *HTTP) entity(w http.ResponseWriter, r *http.Request) {
	profile, ok := h.Service.Profile(r.PathValue("id"))
	if !ok {
		fail(w, problem("not_found", 404))
		return
	}
	respond(w, 200, profile)
}

func (h *HTTP) order(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind string `json:"kind"`
	}
	if err := readBody(w, r, &in); err != nil {
		fail(w, err)
		return
	}
	entity, err := h.Service.Order(r.PathValue("id"), in.Kind, payloadHash(owner(r)))
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, map[string]any{
		"id":         entity.ID,
		"order":      entity.Order,
		"orderUntil": entity.OrderUntil,
		"ordersUsed": entity.OrderCount,
		"hp":         entity.HP,
	})
}

func owner(r *http.Request) string {
	cookie, err := r.Cookie(ownerCookie)
	if err != nil || len(cookie.Value) != 64 {
		return ""
	}
	if _, err = hex.DecodeString(cookie.Value); err != nil {
		return ""
	}
	return cookie.Value
}

func readBody(w http.ResponseWriter, r *http.Request, out any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return problem("invalid_input", 400)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return problem("invalid_input", 400)
	}
	return nil
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		slog.Warn("reach: encode response", "error", err)
	}
}

// fail renders the shared error shape. Field diagnostics are flattened into the
// body so an agent can address each one without parsing prose.
func fail(w http.ResponseWriter, err error) {
	var p *Problem
	if errors.As(err, &p) {
		body := map[string]any{"code": p.Code}
		if len(p.Fields) > 0 {
			body["fields"] = p.Fields
		}
		respond(w, p.Status, body)
		return
	}
	respond(w, 500, map[string]string{"code": "storage_unavailable"})
}

func payloadHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
