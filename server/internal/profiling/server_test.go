package profiling

import "testing"

func TestNewServerAddress(t *testing.T) {
	for _, tc := range []struct{ name, env, want string }{
		{"default", "", Addr},
		{"isolated instance", "127.0.0.1:26060", "127.0.0.1:26060"},
		{"whitespace", " 127.0.0.1:26060 ", "127.0.0.1:26060"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("AURO_PPROF_ADDR", tc.env)
			if got := NewServer().Addr; got != tc.want {
				t.Fatalf("Addr = %q, want %q", got, tc.want)
			}
		})
	}
}
