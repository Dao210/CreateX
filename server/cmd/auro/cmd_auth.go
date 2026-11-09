package main

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"

	"github.com/auro-ai/auro/server/internal/auth"
	"github.com/auro-ai/auro/server/internal/cli"
)

// loginTokenPrefixes are the token prefixes `auro login --token` accepts.
// The CLI used to hardcode `mul_` only, which made it impossible to log in
// with a Auro Cloud Node PAT (`mcn_`) even though the server happily
// authenticates both kinds. Keep this list in sync with the prefix branches
// in server/internal/middleware/auth.go.
var loginTokenPrefixes = []string{"mul_", auth.CloudPATPrefix}

// validateLoginTokenPrefix returns nil if token starts with one of the
// CLI-recognised PAT prefixes, or an error describing the accepted set.
// Extracted so the prefix list has one obvious test surface.
func validateLoginTokenPrefix(token string) error {
	for _, p := range loginTokenPrefixes {
		if strings.HasPrefix(token, p) {
			return nil
		}
	}
	return fmt.Errorf("invalid token format: must start with %s", strings.Join(loginTokenPrefixes, " or "))
}

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Authenticate auro with Auro",
}

var authStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show current authentication status",
	RunE:  runAuthStatus,
}

var authLogoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Remove stored authentication token",
	RunE:  runAuthLogout,
}

// callbackHostFlag lets users override the host/IP that goes into the OAuth
// cli_callback URL. Useful when the CLI sits behind a reverse proxy or the
// auto-detected LAN IP isn't the one the browser can reach.
const callbackHostFlag = "callback-host"

const callbackHostFlagHelp = "Host/IP the OAuth callback URL points at when the browser can reach this CLI directly. For SSH-only machines, use the printed tunnel hint instead."

func init() {
	authCmd.AddCommand(authStatusCmd)
	authCmd.AddCommand(authLogoutCmd)
}

func resolveToken(cmd *cobra.Command) string {
	if v := strings.TrimSpace(os.Getenv("AURO_TOKEN")); v != "" {
		return v
	}
	// Inside a daemon-managed task, never fall back to the user-global config
	// token: that silent fallback is how agent writes land as the wrong actor.
	// inDaemonManagedExecutionContext already covers the AURO_DAEMON_PORT
	// signal for subprocesses that lost AURO_AGENT_ID / AURO_TASK_ID.
	if inDaemonManagedExecutionContext() {
		return ""
	}
	profile := resolveProfile(cmd)
	cfg, _ := cli.LoadCLIConfigForProfile(profile)
	return cfg.Token
}

func resolveAppURL(cmd *cobra.Command) string {
	for _, key := range []string{"AURO_APP_URL", "FRONTEND_ORIGIN"} {
		if val := strings.TrimSpace(os.Getenv(key)); val != "" {
			return strings.TrimRight(val, "/")
		}
	}
	profile := resolveProfile(cmd)
	cfg, err := cli.LoadCLIConfigForProfile(profile)
	if err == nil && cfg.AppURL != "" {
		return strings.TrimRight(cfg.AppURL, "/")
	}
	fmt.Fprintln(os.Stderr, "No app URL configured. Run 'auro setup' first.")
	os.Exit(1)
	return "" // unreachable
}

func openBrowser(url string) error {
	var cmd string
	var args []string
	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "linux":
		cmd = "xdg-open"
		args = []string{url}
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	default:
		return fmt.Errorf("unsupported platform: %s", runtime.GOOS)
	}
	return exec.Command(cmd, args...).Start()
}

func runAuthLogin(cmd *cobra.Command, args []string) error {
	if err := requireHumanLocalCommand("login"); err != nil {
		return err
	}
	if cmd.Flags().Changed("token") {
		tokenFlag, _ := cmd.Flags().GetString("token")
		// `--token mul_xxx` (space form) is what users actually type — that's
		// the form from the docs and from #1994. NoOptDefVal prevents pflag
		// from consuming the next arg as the flag value, so it lands here as
		// a positional. Promote it to the token value.
		if tokenFlag == tokenPromptSentinel && len(args) == 1 {
			tokenFlag = args[0]
		}
		return runAuthLoginToken(cmd, tokenFlag)
	}
	return runAuthLoginBrowser(cmd)
}

// resolveCallbackBinding picks the host that goes into the `cli_callback`
// URL and the interface the CLI should bind its local HTTP listener to.
//
// The browser running the login flow is on the *server's* machine (or
// wherever the user clicked the link), not on the CLI host. That means the
// callback URL must resolve to an address the browser can actually reach,
// which is different in each topology:
//
//   - hosted / public app URL: browser and CLI are on the same machine,
//     localhost works.
//   - self-host, CLI on server box: same as above.
//   - self-host, CLI on a different LAN box: the callback URL must point at
//     the CLI's own LAN IP, not the server's.
//   - reverse-proxied / FQDN setups: auto-detection can't know the right
//     host — the user supplies it via --callback-host.
//
// detectOutbound is injected so tests can exercise the routing decisions
// without real network calls.
func resolveCallbackBinding(flagHost, serverURL, appURL string, detectOutbound func(string) net.IP) (callbackHost, bindAddr string) {
	// Explicit flag always wins. Bind on all interfaces so the browser can
	// reach us regardless of which interface the host name resolves to.
	if h := strings.TrimSpace(flagHost); h != "" {
		return h, "0.0.0.0"
	}

	appIP := urlPrivateIP(appURL)
	if appIP == nil {
		// Public hostname, FQDN without private-IP mapping, or parse error.
		// Loopback is the only safe default — on hosted/public setups the
		// browser and CLI live on the same machine.
		return "localhost", "127.0.0.1"
	}

	// app_url is a private LAN IP. Figure out whether the CLI is on that
	// same box or a different one by asking the kernel which local address
	// it would use to reach the server. Same box → loopback is fine.
	// Different box → use the CLI's outbound IP so the browser can reach us.
	cliIP := detectOutbound(serverURL)
	if cliIP == nil {
		// Detection failed (offline, unreachable server, etc.). Fall back to
		// the app IP — preserves the pre-existing same-machine behaviour.
		return appIP.String(), "0.0.0.0"
	}
	if cliIP.Equal(appIP) {
		return "localhost", "127.0.0.1"
	}
	return cliIP.String(), "0.0.0.0"
}

// urlPrivateIP returns the hostname of rawURL parsed as an RFC 1918 IP, or
// nil if the URL is unparsable or the host is not a private literal.
func urlPrivateIP(rawURL string) net.IP {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil
	}
	ip := net.ParseIP(parsed.Hostname())
	if ip == nil || !ip.IsPrivate() {
		return nil
	}
	return ip
}

// detectOutboundIP returns the local IPv4 address the OS would use to reach
// serverURL, or nil if detection fails. The UDP dial does not send packets —
// it just causes the kernel to pick a source IP for the destination route.
func detectOutboundIP(serverURL string) net.IP {
	parsed, err := url.Parse(serverURL)
	if err != nil || parsed.Hostname() == "" {
		return nil
	}
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	conn, err := net.Dial("udp4", net.JoinHostPort(parsed.Hostname(), port))
	if err != nil {
		return nil
	}
	defer conn.Close()
	local, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || local.IP == nil {
		return nil
	}
	// Normalise to 4-byte form so Equal() comparisons match net.ParseIP
	// output consistently.
	if v4 := local.IP.To4(); v4 != nil {
		return v4
	}
	return local.IP
}

func runAuthLoginBrowser(cmd *cobra.Command) error {
	serverURL := resolveHumanServerURL(cmd)
	appURL := resolveAppURL(cmd)

	flagHost := callbackHostFlagValue(cmd)
	callbackHost, bindAddr := resolveCallbackBinding(flagHost, serverURL, appURL, detectOutboundIP)

	// Pin to "tcp4" — a bare "tcp" on macOS can produce an IPv6-only socket
	// that IPv4 clients (including browsers resolving localhost → 127.0.0.1)
	// cannot reach. The callback URL is always an IPv4 literal or hostname,
	// so an IPv4 listener is what the browser actually needs.
	listener, err := net.Listen("tcp4", bindAddr+":0")
	if err != nil {
		return fmt.Errorf("could not start the local login callback server (used to receive the browser sign-in); a firewall or another process may be blocking local ports: %w", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	callbackURL := fmt.Sprintf("http://%s:%d/callback", callbackHost, port)

	// Generate a random state parameter for CSRF protection.
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		return fmt.Errorf("failed to generate state: %w", err)
	}
	state := hex.EncodeToString(stateBytes)

	loginURL := fmt.Sprintf("%s/login?cli_callback=%s&cli_state=%s", appURL, url.QueryEscape(callbackURL), url.QueryEscape(state))

	// Channel to receive the JWT from the browser callback.
	jwtCh := make(chan string, 1)
	errCh := make(chan error, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "missing token", http.StatusBadRequest)
			return
		}
		returnedState := r.URL.Query().Get("state")
		if returnedState != state {
			http.Error(w, "invalid state parameter", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte(callbackSuccessHTML))
		jwtCh <- token
	})

	srv := &http.Server{Handler: mux}
	go func() {
		if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	defer srv.Close()

	// Open the browser.
	fmt.Fprintln(os.Stderr, "Opening browser to authenticate...")
	if err := openBrowser(loginURL); err != nil {
		fmt.Fprintf(os.Stderr, "Could not open browser automatically.\n")
	}
	fmt.Fprint(os.Stderr, browserLoginInstructions(loginURL, callbackHost, port, runningInSSHSession()))

	// Wait for the JWT from the callback (timeout 5 minutes).
	var jwtToken string
	select {
	case jwtToken = <-jwtCh:
	case err := <-errCh:
		return fmt.Errorf("local server error: %w", err)
	case <-time.After(5 * time.Minute):
		return fmt.Errorf("timed out waiting for authentication")
	}

	// Use the JWT to create a PAT via the existing API.
	client := cli.NewAPIClient(serverURL, "", jwtToken)

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	hostname, _ := os.Hostname()
	if hostname == "" {
		hostname = "unknown"
	}
	patName := fmt.Sprintf("CLI (%s)", hostname)
	expiresInDays := 90

	var patResp struct {
		Token string `json:"token"`
	}
	err = client.PostJSON(ctx, "/api/tokens", map[string]any{
		"name":            patName,
		"expires_in_days": expiresInDays,
	}, &patResp)
	if err != nil {
		return cli.WithUserMessageUnlessNetwork("Sign-in did not complete: the server could not issue an access token for the CLI. Run `auro login` again.", err)
	}

	// Verify the PAT works.
	patClient := cli.NewAPIClient(serverURL, "", patResp.Token)
	var me struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := patClient.GetJSON(ctx, "/api/me", &me); err != nil {
		return cli.WithUserMessageUnlessNetwork("Sign-in did not complete: the server did not accept the new credential. Run `auro login` again.", err)
	}

	// Save to config. Reset workspace data on every login — the user or
	// server may have changed, so stale workspaces must not persist.
	profile := resolveProfile(cmd)
	cfg, _ := cli.LoadCLIConfigForProfile(profile)
	cfg.WorkspaceID = ""
	cfg.Token = patResp.Token
	cfg.ServerURL = serverURL
	cfg.AppURL = appURL
	if err := cli.SaveCLIConfigForProfile(cfg, profile); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Authenticated as %s (%s)\nToken saved to config.\n", me.Name, me.Email)
	return nil
}

func runningInSSHSession() bool {
	for _, key := range []string{"SSH_CONNECTION", "SSH_CLIENT", "SSH_TTY"} {
		if strings.TrimSpace(os.Getenv(key)) != "" {
			return true
		}
	}
	return false
}

func callbackHostFlagValue(cmd *cobra.Command) string {
	for c := cmd; c != nil; c = c.Parent() {
		if value := nonEmptyFlagValue(c.Flags(), callbackHostFlag); value != "" {
			return value
		}
		if value := nonEmptyFlagValue(c.PersistentFlags(), callbackHostFlag); value != "" {
			return value
		}
		if value := nonEmptyFlagValue(c.InheritedFlags(), callbackHostFlag); value != "" {
			return value
		}
	}
	return ""
}

func nonEmptyFlagValue(flags *pflag.FlagSet, name string) string {
	if flag := flags.Lookup(name); flag != nil {
		return strings.TrimSpace(flag.Value.String())
	}
	return ""
}

func callbackHostIsLoopback(host string) bool {
	h := strings.Trim(strings.TrimSpace(host), "[]")
	if h == "localhost" {
		return true
	}
	ip := net.ParseIP(h)
	return ip != nil && ip.IsLoopback()
}

func browserLoginInstructions(loginURL, callbackHost string, port int, remoteSSH bool) string {
	var b strings.Builder
	fmt.Fprintf(&b, "If the browser didn't open, visit:\n  %s\n", loginURL)
	if remoteSSH && callbackHostIsLoopback(callbackHost) {
		fmt.Fprintf(&b, "\nRemote SSH session detected. Before opening that URL on your local computer, forward the callback port in another terminal:\n  ssh -L %d:127.0.0.1:%d <user>@<remote-host>\nThen open the URL above in your local browser.\n", port, port)
	}
	fmt.Fprintln(&b, "\nWaiting for authentication...")
	return b.String()
}

func runAuthLoginToken(cmd *cobra.Command, providedToken string) error {
	// The prompt sentinel is what pflag substitutes for `--token` with no
	// value (see loginCmd init); treat it the same as an empty string so we
	// fall through to the interactive prompt.
	if providedToken == tokenPromptSentinel {
		providedToken = ""
	}
	token := strings.TrimSpace(providedToken)
	if token == "" {
		fmt.Print("Enter your personal access token: ")
		scanner := bufio.NewScanner(os.Stdin)
		if !scanner.Scan() {
			return fmt.Errorf("no input")
		}
		token = strings.TrimSpace(scanner.Text())
	}
	if token == "" {
		return fmt.Errorf("token is required")
	}
	if err := validateLoginTokenPrefix(token); err != nil {
		return err
	}

	serverURL := resolveLoginTokenServerURL(cmd)
	client := cli.NewAPIClient(serverURL, "", token)

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var me struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := client.GetJSON(ctx, "/api/me", &me); err != nil {
		return cli.WithUserMessageUnlessNetwork("Could not sign in with that token — make sure it is valid and not expired, then run `auro login --token <token>` again.", err)
	}

	profile := resolveProfile(cmd)
	cfg, _ := cli.LoadCLIConfigForProfile(profile)
	cfg.WorkspaceID = ""
	cfg.Token = token
	cfg.ServerURL = serverURL
	if cfg.AppURL == "" && serverURL == defaultCloudServerURL {
		cfg.AppURL = defaultCloudAppURL
	}
	if err := cli.SaveCLIConfigForProfile(cfg, profile); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	fmt.Fprintf(os.Stderr, "Authenticated as %s (%s)\nToken saved to config.\n", me.Name, me.Email)
	return nil
}

func runAuthStatus(cmd *cobra.Command, _ []string) error {
	if err := requireTaskLocalConfigRoot(); err != nil {
		return err
	}
	taskContext := inDaemonManagedExecutionContext()
	token := resolveToken(cmd)
	if taskContext && !strings.HasPrefix(token, "mat_") {
		return fmt.Errorf("agent execution context requires AURO_TOKEN to be a task-scoped mat_ token")
	}
	serverURL := resolveServerURL(cmd)

	if token == "" {
		fmt.Fprintln(os.Stderr, "Not authenticated. Run 'auro login' to authenticate.")
		return nil
	}

	client := cli.NewAPIClient(serverURL, "", token)

	ctx, cancel := cli.APIContext(context.Background())
	defer cancel()

	var me struct {
		Name  string `json:"name"`
		Email string `json:"email"`
	}
	if err := client.GetJSON(ctx, "/api/me", &me); err != nil {
		fmt.Fprintf(os.Stderr, "Token is invalid or expired: %v\nRun 'auro login' to re-authenticate.\n", err)
		return nil
	}

	if taskContext {
		fmt.Fprintf(os.Stderr, "Server:  %s\nUser:    %s (%s)\n", serverURL, me.Name, me.Email)
		return nil
	}

	prefix := token
	if len(prefix) > 12 {
		prefix = prefix[:12] + "..."
	}
	fmt.Fprintf(os.Stderr, "Server:  %s\nUser:    %s (%s)\nToken:   %s\n", serverURL, me.Name, me.Email, prefix)
	return nil
}

const callbackSuccessHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auro — Authenticated</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0b0b0f; --card-bg: #16161d; --border: rgba(255,255,255,0.10); --fg: #f5f5f5; --fg2: #a1a1aa; --accent: #22c55e; --accent-bg: rgba(34,197,94,0.12); }
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f8f8fa; --card-bg: #ffffff; --border: rgba(0,0,0,0.08); --fg: #0f0f12; --fg2: #71717a; --accent: #16a34a; --accent-bg: rgba(22,163,74,0.08); }
  }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; background: var(--bg); color: var(--fg); display: flex; align-items: center; justify-content: center; min-height: 100vh; }
  .card { width: 100%; max-width: 380px; border: 1px solid var(--border); border-radius: 12px; background: var(--card-bg); padding: 40px 32px; text-align: center; }
  .icon-wrap { width: 48px; height: 48px; margin: 0 auto 24px; background: var(--accent-bg); border-radius: 50%; display: flex; align-items: center; justify-content: center; }
  .icon-wrap svg { width: 24px; height: 24px; color: var(--accent); }
  .brand { display: flex; align-items: center; justify-content: center; gap: 6px; margin-bottom: 8px; }
  .brand-mark { display: block; width: 40px; height: auto; }
  h1 { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
  p { font-size: 14px; color: var(--fg2); line-height: 1.5; }
  .hint { margin-top: 24px; font-size: 13px; color: var(--fg2); opacity: 0.7; }
</style>
</head>
<body>
  <div class="card">
    <div class="icon-wrap">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
    </div>
    <div class="brand"><svg class="brand-mark" viewBox="0 0 322.41 191.11" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M70.7 186C39.3 179.8 12.8 154.5 3.5 122C0 109.7 0.2 88.5 4.1 76C19.5 25.7 72.7 0 123 18.6C131.2 21.6 142.7 28.1 143.4 30C143.6 30.6 138.1 36.3 131.3 42.7L118.9 54.4L112.1 51.5C75 36 35.7 61.2 35.7 100.5C35.7 116 41.3 128.4 53.3 139.5C72.5 157.2 99.9 157.7 122.5 140.7C127.6 136.9 132.9 131.8 176.2 89.5C201.4 64.8 204.4 63 219.2 63C228.7 63 229.7 63.2 235.9 66.4C239.6 68.2 243.4 70.6 244.4 71.7C246.1 73.6 246 73.8 240.7 78.8C237.6 81.6 221.2 97.5 204.2 114C149.6 167 147.9 168.6 134.5 175.9C116.5 185.8 90.4 189.9 70.7 186ZM207.7 186.4C194.8 184.9 177.3 178.5 168.4 172.2L165.5 170.2L177.7 158.6C184.5 152.2 190.3 146.8 190.8 146.7C191.2 146.5 194.5 147.7 198 149.4C232.4 165.8 272.7 139.4 272.7 100.5C272.7 75.6 254.3 52.5 230.5 47.4C223.2 45.8 209.4 46.8 202.5 49.4C192.1 53.4 190.5 54.8 143.1 101.6C110.8 133.4 105.2 137.1 88.7 136.9C80.1 136.9 73 134.6 67.2 130.2C64.7 128.3 59.7 133.5 116.3 78C153.6 41.5 164.2 31.6 171.5 26.7C193.4 12.3 222.2 8.5 247.7 16.7C297.3 32.5 322.4 91.1 299.7 138C283.4 171.5 246.2 191.1 207.7 186.4Z"/></svg></div>
    <h1>Authentication successful</h1>
    <p>You can close this tab and return to the terminal.</p>
    <p class="hint">Your CLI session is now authenticated.</p>
  </div>
  <script>setTimeout(function(){window.close()},3000)</script>
</body>
</html>`

func runAuthLogout(cmd *cobra.Command, _ []string) error {
	if err := requireHumanLocalCommand("logout"); err != nil {
		return err
	}
	profile := resolveProfile(cmd)
	cfg, _ := cli.LoadCLIConfigForProfile(profile)
	if cfg.Token == "" {
		fmt.Fprintln(os.Stderr, "Not authenticated.")
		return nil
	}

	cfg.Token = ""
	if err := cli.SaveCLIConfigForProfile(cfg, profile); err != nil {
		return fmt.Errorf("failed to save config: %w", err)
	}

	fmt.Fprintln(os.Stderr, "Token removed. You are now logged out.")
	return nil
}
