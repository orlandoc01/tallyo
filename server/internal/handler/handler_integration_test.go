package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	accountsdb "tallyo/internal/accounts/db"
	admindb "tallyo/internal/admin/db"
	"tallyo/internal/admin/runtimeconfig"
	"tallyo/internal/auth"
	"tallyo/internal/auth/authdb"
	"tallyo/internal/graph"
	"tallyo/internal/transactions"
	transactionsdb "tallyo/internal/transactions/db"
	"tallyo/internal/utils/must"
	testutil "tallyo/internal/utils/test"
)

type handlerTestStore struct {
	*testutil.Store
	Accounts     *accountsdb.Store
	Admin        *admindb.Store
	Transactions *transactionsdb.Store
}

func assertStatus(t *testing.T, w *httptest.ResponseRecorder, want int, label string) {
	t.Helper()
	if w.Code != want {
		t.Fatalf("%sstatus = %d, want %d", label, w.Code, want)
	}
}

func TestExportHandlerSuccess(t *testing.T) {
	store := openTestStore(t)
	handler := exportHandler(store.Transactions, testutil.Logger)

	req := httptest.NewRequest(http.MethodGet, "/transactions/export", nil)
	req = req.WithContext(auth.ContextWithScopes(req.Context(), auth.AllScopes))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assertStatus(t, w, http.StatusOK, "")
	if ct := w.Header().Get("Content-Type"); ct != "text/csv" {
		t.Fatalf("content-type = %q, want %q", ct, "text/csv")
	}
	if cd := w.Header().Get("Content-Disposition"); !strings.Contains(cd, "attachment;") {
		t.Fatalf("content-disposition = %q, want attachment", cd)
	}
	if !strings.Contains(w.Body.String(), "external_id,source,datetime,posted_datetime,amount") {
		t.Fatalf("body missing csv header: %q", w.Body.String())
	}
}

func TestImportHandlerRejectsMissingMultipartFile(t *testing.T) {
	store := openTestStore(t)
	handler := requireScope(auth.ScopeWriteTransactions, importHandler(store.Transactions, testutil.Logger))

	req := httptest.NewRequest(http.MethodPost, "/transactions/import", nil)
	req = req.WithContext(auth.ContextWithScopes(req.Context(), auth.AllScopes))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)

	assertStatus(t, w, http.StatusBadRequest, "")
}

func openTestStore(t *testing.T) *handlerTestStore {
	t.Helper()
	store := testutil.OpenStore(t)
	return &handlerTestStore{Store: store, Accounts: accountsdb.New(store.Database()), Admin: admindb.New(store.Database()), Transactions: transactionsdb.New(store.Database())}
}

func TestImportHandlerSuccessAndForbidden(t *testing.T) {
	store := openTestStore(t)
	testutil.SeedPlaidAccount(t, store.Accounts, store.Admin, "acc-1", "alex")

	csvContent := "account_id,datetime,amount,merchant_name\nacc-1,2026-05-01,12.34,Coffee\n"
	body := &bytes.Buffer{}
	mw := multipart.NewWriter(body)
	fw, err := mw.CreateFormFile("file", "import.csv")
	must.NoErr(t, err)
	if _, err := fmt.Fprint(fw, csvContent); err != nil {
		t.Fatalf("write csv: %v", err)
	}
	must.NoErr(t, mw.Close())

	handler := requireScope(auth.ScopeWriteTransactions, importHandler(store.Transactions, testutil.Logger))
	req := httptest.NewRequest(http.MethodPost, "/transactions/import", body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req = req.WithContext(auth.ContextWithScopes(req.Context(), auth.AllScopes))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("import status = %d body = %s", w.Code, w.Body.String())
	}
	var result struct {
		Processed int                           `json:"processed"`
		Skipped   int                           `json:"skipped"`
		Errors    []transactions.ImportRowError `json:"errors"`
	}
	must.NoErr(t, json.NewDecoder(w.Body).Decode(&result))
	if result.Processed != 1 {
		t.Fatalf("processed = %d, want 1", result.Processed)
	}
	if result.Skipped != 0 {
		t.Fatalf("skipped = %d, want 0", result.Skipped)
	}
	if result.Errors == nil {
		t.Fatal("errors = nil, want empty slice")
	}

	// Without scopes -> 403.
	req2 := httptest.NewRequest(http.MethodPost, "/transactions/import", nil)
	w2 := httptest.NewRecorder()
	handler.ServeHTTP(w2, req2)
	assertStatus(t, w2, http.StatusForbidden, "")
}

func TestExportForbiddenWithoutScope(t *testing.T) {
	store := openTestStore(t)
	handler := requireScope(auth.ScopeReadTransactions, exportHandler(store.Transactions, testutil.Logger))
	req := httptest.NewRequest(http.MethodGet, "/transactions/export", nil)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, req)
	assertStatus(t, w, http.StatusForbidden, "")
}

func TestSPAFileServerCacheHeadersAndFallback(t *testing.T) {
	testFS := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte(`<html><body>app</body></html>`)},
	}
	handler := newSPAFileServer(testFS)

	assetReq := httptest.NewRequest(http.MethodGet, "/assets/missing.js", nil)
	assetW := httptest.NewRecorder()
	handler.ServeHTTP(assetW, assetReq)
	if got := assetW.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("missing asset cache-control = %q, want no-cache fallback", got)
	}

	indexReq := httptest.NewRequest(http.MethodGet, "/not-a-real-route", nil)
	indexW := httptest.NewRecorder()
	handler.ServeHTTP(indexW, indexReq)
	assertStatus(t, indexW, http.StatusOK, "fallback ")
	if got := indexW.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("fallback cache-control = %q, want no-cache", got)
	}
	if !strings.Contains(indexW.Body.String(), "<html") {
		t.Fatalf("fallback body does not look like index.html")
	}
}

func TestWithRequestTimeoutPreservesValuesAndPropagatesParentCancel(t *testing.T) {
	type contextKey string
	key := contextKey("user")
	parent, cancel := context.WithCancel(context.WithValue(context.Background(), key, "alice"))

	started := make(chan struct{})
	done := make(chan struct{})
	errCh := make(chan string, 1)
	handler := withRequestTimeout(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		if got := r.Context().Value(key); got != "alice" {
			errCh <- fmt.Sprintf("context value = %v, want alice", got)
			return
		}
		close(started)
		select {
		case <-r.Context().Done():
			close(done)
		case <-time.After(time.Second):
			errCh <- "handler context did not inherit parent cancellation"
		}
	}), time.Minute)

	req := httptest.NewRequest(http.MethodPost, "/query", nil).WithContext(parent)
	go handler.ServeHTTP(httptest.NewRecorder(), req)
	select {
	case <-started:
	case msg := <-errCh:
		t.Fatal(msg)
	case <-time.After(time.Second):
		t.Fatal("handler did not start")
	}
	cancel()
	select {
	case <-done:
	case msg := <-errCh:
		t.Fatal(msg)
	case <-time.After(time.Second):
		t.Fatal("handler did not observe parent cancellation")
	}
}

func TestGraphQLRejectsExcessiveTokenDocument(t *testing.T) {
	query := "{" + strings.Repeat("a:__typename ", 20_000) + "}"
	w := postGraphQL(query)
	if w.Code != http.StatusUnprocessableEntity || !strings.Contains(w.Body.String(), "invalid GraphQL request") {
		t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
	}
}

func TestGraphQLIntrospectionUnavailable(t *testing.T) {
	w := postGraphQL(`{ __schema { queryType { name } } }`)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"__schema":null`) {
		t.Fatalf("status = %d body = %s", w.Code, w.Body.String())
	}
}

func postGraphQL(query string) *httptest.ResponseRecorder {
	body := strings.NewReader(fmt.Sprintf(`{"query":%q}`, query))
	req := httptest.NewRequest(http.MethodPost, "/query", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	graphqlServer(&graph.Resolver{}, testutil.Logger).ServeHTTP(w, req)
	return w
}

func TestDynamicMCPMiddlewareDisabled(t *testing.T) {
	store := openTestStore(t)
	ctx := context.Background()
	_, err := store.Admin.SaveSections(ctx, runtimeconfig.Patch{
		MCP: &runtimeconfig.SectionPatch[runtimeconfig.MCPConfig]{Enabled: false},
	})
	must.NoErr(t, err)
	runtimeCfg := runtimeconfig.New(store.Admin)
	must.NoErr(t, runtimeCfg.LoadConfiguration(ctx, true, false))

	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusAccepted) })
	handler := dynamicMCPMiddleware(Config{RuntimeConfig: runtimeCfg}, next)
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/mcp", nil))
	assertStatus(t, w, http.StatusNotFound, "disabled ")
}

func TestNewMCPGETStreamsThroughMiddleware(t *testing.T) {
	store := openTestStore(t)
	ctx := t.Context()
	_, err := store.Admin.SaveSections(ctx, runtimeconfig.Patch{
		MCP: &runtimeconfig.SectionPatch[runtimeconfig.MCPConfig]{Enabled: true},
	})
	must.NoErr(t, err)
	runtimeCfg := runtimeconfig.New(store.Admin)
	must.NoErr(t, runtimeCfg.LoadConfiguration(ctx, true, false))
	authSvc, err := auth.New(ctx, auth.Config{DisableAllAuth: true, Log: testutil.Logger}, authdb.New(store.Database()))
	must.NoErr(t, err)
	router := New(Config{
		Logger:        testutil.Logger,
		Auth:          authSvc,
		Resolver:      &graph.Resolver{},
		Transactions:  store.Transactions,
		RuntimeConfig: runtimeCfg,
	})
	server := httptest.NewServer(router)
	defer server.Close()

	requestCtx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, server.URL+"/mcp", nil)
	must.NoErr(t, err)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := server.Client().Do(req)
	must.NoErr(t, err)
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusOK)
	}
	if got := resp.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content-type = %q, want %q", got, "text/event-stream")
	}
	must.NoErr(t, requestCtx.Err())
	cancel()
}
