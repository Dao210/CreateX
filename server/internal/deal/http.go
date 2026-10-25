package deal

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const ownerCookie = "deal_owner"

type createWindow struct {
	Start time.Time
	Count int
}
type HTTP struct {
	Service       *Service
	SecureCookies bool
	mu            sync.Mutex
	windows       map[string]createWindow
}

func (h *HTTP) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/deal/status", func(w http.ResponseWriter, r *http.Request) {
		respond(w, 200, map[string]any{"mode": h.Service.Mode, "ready": h.Service.Ready, "scenario_version": ScenarioVersion})
	})
	mux.HandleFunc("POST /api/deal/sessions", h.create)
	mux.HandleFunc("GET /api/deal/sessions/{id}", h.read)
	mux.HandleFunc("POST /api/deal/sessions/{id}/turns", h.turn)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
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
		}
		mux.ServeHTTP(w, r)
	})
}

func owner(r *http.Request) string {
	c, err := r.Cookie(ownerCookie)
	if err != nil || len(c.Value) != 64 {
		return ""
	}
	if _, err = hex.DecodeString(c.Value); err != nil {
		return ""
	}
	return c.Value
}

func (h *HTTP) allowCreate(r *http.Request) bool {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.windows == nil {
		h.windows = map[string]createWindow{}
	}
	now := time.Now()
	for key, value := range h.windows {
		if now.Sub(value.Start) > time.Minute {
			delete(h.windows, key)
		}
	}
	window := h.windows[ip]
	if len(h.windows) >= 4096 && window.Start.IsZero() {
		return false
	}
	if window.Start.IsZero() {
		window.Start = now
	}
	if window.Count >= 12 {
		return false
	}
	window.Count++
	h.windows[ip] = window
	return true
}

func (h *HTTP) create(w http.ResponseWriter, r *http.Request) {
	var body struct{}
	if err := readBody(w, r, &body); err != nil {
		fail(w, err)
		return
	}
	if !h.allowCreate(r) {
		fail(w, problem("rate_limited", 429))
		return
	}
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
	view, err := h.Service.Create(token)
	if err != nil {
		fail(w, err)
		return
	}
	if fresh {
		http.SetCookie(w, &http.Cookie{Name: ownerCookie, Value: token, Path: "/api/deal", HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: h.SecureCookies || r.TLS != nil, MaxAge: 60 * 60 * 24 * 30})
	}
	respond(w, 201, view)
}

func (h *HTTP) read(w http.ResponseWriter, r *http.Request) {
	token := owner(r)
	if token == "" {
		fail(w, problem("not_found", 404))
		return
	}
	view, err := h.Service.Read(r.PathValue("id"), token)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, view)
}
func (h *HTTP) turn(w http.ResponseWriter, r *http.Request) {
	token := owner(r)
	if token == "" {
		fail(w, problem("not_found", 404))
		return
	}
	var in Input
	if err := readBody(w, r, &in); err != nil {
		fail(w, err)
		return
	}
	view, err := h.Service.Turn(r.Context(), r.PathValue("id"), token, in)
	if err != nil {
		fail(w, err)
		return
	}
	respond(w, 200, view)
}

func readBody(w http.ResponseWriter, r *http.Request, out any) error {
	r.Body = http.MaxBytesReader(w, r.Body, 16*1024)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		return problem("invalid_input", 400)
	}
	var extra any
	if err := d.Decode(&extra); err != io.EOF {
		return problem("invalid_input", 400)
	}
	return nil
}
func respond(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}
func fail(w http.ResponseWriter, err error) {
	var p *Problem
	if errors.As(err, &p) {
		respond(w, p.Status, map[string]string{"code": p.Code})
		return
	}
	slog.Error("DEAL request failed", "error", err)
	respond(w, 500, map[string]string{"code": "storage_unavailable"})
}
