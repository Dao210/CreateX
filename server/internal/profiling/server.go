package profiling

import (
	"net/http"
	httppprof "net/http/pprof"
	"os"
	"strings"
	"time"
)

const Addr = "127.0.0.1:6060"

func NewHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /debug/pprof/", httppprof.Index)
	mux.HandleFunc("GET /debug/pprof/cmdline", httppprof.Cmdline)
	mux.HandleFunc("GET /debug/pprof/profile", httppprof.Profile)
	mux.HandleFunc("GET /debug/pprof/symbol", httppprof.Symbol)
	mux.HandleFunc("POST /debug/pprof/symbol", httppprof.Symbol)
	mux.HandleFunc("GET /debug/pprof/trace", httppprof.Trace)
	return mux
}

func NewServer() *http.Server {
	addr := strings.TrimSpace(os.Getenv("AURO_PPROF_ADDR"))
	if addr == "" {
		addr = Addr
	}
	return &http.Server{
		Addr:              addr,
		Handler:           NewHandler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       30 * time.Second,
		// CPU profiles and traces run for a caller-selected duration. Leave
		// ReadTimeout and WriteTimeout unset so long captures are not truncated.
	}
}
