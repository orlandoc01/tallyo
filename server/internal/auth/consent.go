package auth

import (
	"html/template"
	"net/http"
	"net/url"
)

// Consent handles the /consent endpoint that MCP clients (e.g. claude.ai) probe
// to verify the OAuth server's consent flow. FastMCP-based servers return 400
// here when no valid session is present; we do the same so MCP clients see a
// recognizable error rather than the SPA catch-all HTML.
func (s *Service) Consent(w http.ResponseWriter, r *http.Request) {
	sessionID, ok := consentSessionID(w, r)
	if !ok {
		return
	}
	if r.FormValue("consent") != "allow" {
		s.denyAuthorize(w, r, sessionID)
		return
	}
	s.completeAuthorize(w, r, sessionID, true)
}

func (s *Service) ConsentForm(w http.ResponseWriter, r *http.Request) {
	sessionID, ok := consentSessionID(w, r)
	if !ok {
		return
	}
	s.renderConsentForSession(w, r, sessionID)
}

func consentSessionID(w http.ResponseWriter, r *http.Request) (string, bool) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid form", http.StatusBadRequest)
		return "", false
	}
	sessionID := r.FormValue("session_id")
	if sessionID == "" {
		writeJSONStatus(w, http.StatusBadRequest, map[string]string{
			"error":             "invalid_request",
			"error_description": "No active authorization session",
		})
		return "", false
	}
	return sessionID, true
}

func (s *Service) renderConsentForSession(w http.ResponseWriter, r *http.Request, sessionID string) {
	session, client, ok := s.loginSessionClient(w, r, sessionID)
	if !ok {
		return
	}
	role, err := s.roleForSession(r.Context(), session)
	if err != nil {
		s.cfg.Log.Error("load consent user role", "subject", session.Subject, "error", err)
		http.Error(w, "load user role", http.StatusInternalServerError)
		return
	}
	s.renderConsent(w, session, client, GrantedScopesForRole(role, session.Scopes))
}

func (s *Service) renderConsent(w http.ResponseWriter, session LoginSession, client Client, scopes []string) {
	name := client.ClientName
	if name == "" {
		name = client.ID
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := consentTemplate.Execute(w, struct {
		ClientName  string
		RedirectURI string
		Scopes      []string
		SessionID   string
	}{
		ClientName:  name,
		RedirectURI: session.RedirectURI,
		Scopes:      scopes,
		SessionID:   session.ID,
	}); err != nil {
		s.cfg.Log.Error("render consent", "error", err)
	}
}

func (s *Service) denyAuthorize(w http.ResponseWriter, r *http.Request, sessionID string) {
	session, err := s.store.LoginSessionByID(r.Context(), sessionID)
	if HTTPFail(w, err, http.StatusBadRequest, "login session expired") {
		return
	}
	if err := s.store.DeleteLoginSession(r.Context(), session.ID); err != nil {
		s.cfg.Log.Warn("delete denied login session", "err", err)
	}
	redirectURI, err := url.Parse(session.RedirectURI)
	if HTTPFail(w, err, http.StatusForbidden, "access denied") {
		return
	}
	q := redirectURI.Query()
	q.Set("error", "access_denied")
	if session.State != "" {
		q.Set("state", session.State)
	}
	redirectURI.RawQuery = q.Encode()
	http.Redirect(w, r, redirectURI.String(), http.StatusFound)
}

var consentTemplate = template.Must(template.New("oauth-consent").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize OAuth Client</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    main {
      width: min(92vw, 32rem);
      background: #111827;
      border: 1px solid #334155;
      border-radius: 1rem;
      padding: 2rem;
      box-shadow: 0 24px 80px rgba(0,0,0,.35);
    }
    h1 { margin: 0 0 1rem; font-size: 1.5rem; }
    p, li { color: #cbd5e1; line-height: 1.5; }
    code {
      display: block;
      overflow-wrap: anywhere;
      padding: .75rem;
      border-radius: .5rem;
      background: #020617;
      color: #bfdbfe;
    }
    ul { padding-left: 1.25rem; }
    form { display: flex; gap: .75rem; margin-top: 1.5rem; }
    button {
      border: 0;
      border-radius: .5rem;
      padding: .75rem 1rem;
      font-weight: 700;
      cursor: pointer;
    }
    button[value="allow"] { background: #22c55e; color: #052e16; }
    button[value="deny"] { background: #334155; color: #f8fafc; }
  </style>
</head>
<body>
  <main>
    <h1>Authorize {{.ClientName}}</h1>
    <p>This third-party OAuth client wants access to your Tallyo account.</p>
    <p>Redirect URI:</p>
    <code>{{.RedirectURI}}</code>
    <p>Scopes that will be granted:</p>
    {{if .Scopes}}
    <ul>{{range .Scopes}}<li>{{.}}</li>{{end}}</ul>
    {{else}}
    <p>No scopes requested.</p>
    {{end}}
    <form method="post" action="/consent">
      <input type="hidden" name="session_id" value="{{.SessionID}}">
      <button type="submit" name="consent" value="allow">Allow</button>
      <button type="submit" name="consent" value="deny">Deny</button>
    </form>
  </main>
</body>
</html>`))
