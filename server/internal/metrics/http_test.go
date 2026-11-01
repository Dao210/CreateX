package metrics

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestHTTPMiddlewareRecordsDaemonWorkspaceResponseSizeByStatus(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})

	r := chi.NewRouter()
	r.Use(registry.HTTP.Middleware)
	r.Get(daemonWorkspaceRoutePattern, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("If-None-Match") != "" {
			w.WriteHeader(http.StatusNotModified)
			return
		}
		_, _ = w.Write([]byte(`[]`))
	})

	for _, etag := range []string{"", `W/"workspace-v1"`} {
		req := httptest.NewRequest(http.MethodGet, daemonWorkspaceRoutePattern, nil)
		req.Header.Set("If-None-Match", etag)
		r.ServeHTTP(httptest.NewRecorder(), req)
	}

	metricsRec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(metricsRec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := metricsRec.Body.String()
	for _, want := range []string{
		`auro_http_daemon_workspace_response_size_bytes_count{status="200"} 1`,
		`auro_http_daemon_workspace_response_size_bytes_sum{status="200"} 2`,
		`auro_http_daemon_workspace_response_size_bytes_count{status="304"} 1`,
		`auro_http_daemon_workspace_response_size_bytes_sum{status="304"} 0`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics body missing %q\n%s", want, body)
		}
	}
}

func TestMetricsHandlerOnlyServesMetricsPath(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})
	handler := NewHandler(registry.Gatherer)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("/metrics status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body, _ := io.ReadAll(rec.Body); !strings.Contains(string(body), "auro_build_info") {
		t.Fatalf("/metrics body missing build info: %s", body)
	}

	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("/health status = %d, want %d", rec.Code, http.StatusNotFound)
	}
}

func TestHTTPMiddlewareSkipsHealthProbePaths(t *testing.T) {
	registry := NewRegistry(RegistryOptions{})

	r := chi.NewRouter()
	r.Use(registry.HTTP.Middleware)
	r.Get("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	r.Get("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	for _, path := range []string{"/health", "/readyz"} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want %d", path, rec.Code, http.StatusOK)
		}
	}

	metricsRec := httptest.NewRecorder()
	NewHandler(registry.Gatherer).ServeHTTP(metricsRec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := metricsRec.Body.String()
	for _, skippedRoute := range []string{`route="/health"`, `route="/readyz"`} {
		if strings.Contains(body, skippedRoute) {
			t.Fatalf("metrics body contains skipped health route %q\n%s", skippedRoute, body)
		}
	}
}
