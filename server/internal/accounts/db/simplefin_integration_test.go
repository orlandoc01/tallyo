package accountsdb_test

import (
	"context"
	"testing"
	"time"

	"tallyo/internal/accounts"
	accountsdb "tallyo/internal/accounts/db"
	"tallyo/internal/database/dbtest"
	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
	"tallyo/internal/utils/test"
)

func TestSimpleFinLifecycle(t *testing.T) {
	ctx := context.Background()
	db := dbtest.Open(t)
	s := accountsdb.New(db)

	owner := test.MustCreateOwner(t, s, model.CreateOwnerInput{Name: "alex"})
	token, err := s.CreateSimpleFinAccessToken(ctx, "https://user:pass@bridge.example/simplefin", owner.ID.Int64(), "Bridge")
	must.NoErr(t, err)
	if token.NextSyncAt == nil || token.Owner == nil || token.Owner.ID != owner.ID {
		t.Fatalf("token = %#v", token)
	}
	tokenID := token.ID.Int64()

	listed, err := s.SimpleFinAccessTokens(ctx)
	if err != nil || len(listed) != 1 {
		t.Fatalf("SimpleFinAccessTokens() = %#v, %v", listed, err)
	}
	orgID := "mx.bank"
	orgDomain := "bank.example"
	orgURL := "https://bank.example"
	sfinURL := "https://bridge.example/simplefin"
	logoURL := "https://icons.duckduckgo.com/ip3/bank.example.ico"
	connID, connectionID, err := s.LinkSimpleFinConnection(ctx, accounts.UpsertSimpleFinConnectionParams{
		ExternalID:    "conn-1",
		AccessTokenID: tokenID,
		OrgID:         &orgID,
		OrgDomain:     &orgDomain,
		OrgURL:        &orgURL,
		SfinURL:       &sfinURL,
		LogoURL:       &logoURL,
		Name:          "Bank",
		OwnerID:       owner.ID.Int64(),
	})
	must.NoErr(t, err)
	sfConn, err := s.SimpleFinConnectionByConnID(ctx, connID)
	if err != nil || sfConn == nil || sfConn.ID.Int64() != connID {
		t.Fatalf("SimpleFinConnectionByConnID() = %#v, %v", sfConn, err)
	}
	conn, err := s.ConnectionByID(ctx, connectionID)
	if err != nil || conn == nil || conn.Name == nil || *conn.Name != "Bank" {
		t.Fatalf("ConnectionByID() = %#v, %v", conn, err)
	}
	byToken, err := s.SimpleFinConnectionsByTokenIDs(ctx, []int64{tokenID})
	if err != nil || len(byToken[tokenID]) != 1 {
		t.Fatalf("SimpleFinConnectionsByTokenIDs() = %#v, %v", byToken, err)
	}

	account := &model.Account{
		Connection: conn,
		Owner:      owner,
		Name:       "Checking",
		Type:       model.AccountTypeDepository,
	}
	test.MustUpsertAccount(t, s, "acc-1", account)
	sfConn, err = s.SimpleFinConnectionByConnID(ctx, connID)
	if err != nil || sfConn == nil || len(sfConn.Accounts) != 1 || sfConn.Accounts[0].ID != account.ID {
		t.Fatalf("SimpleFinConnectionByConnID() accounts = %#v, %v", sfConn, err)
	}
	byToken, err = s.SimpleFinConnectionsByTokenIDs(ctx, []int64{tokenID})
	if err != nil || len(byToken[tokenID]) != 1 || len(byToken[tokenID][0].Accounts) != 1 || byToken[tokenID][0].Accounts[0].ID != account.ID {
		t.Fatalf("SimpleFinConnectionsByTokenIDs() accounts = %#v, %v", byToken, err)
	}
	emptyToken, err := s.CreateSimpleFinAccessToken(ctx, "https://other@example/simplefin", owner.ID.Int64(), "Other")
	must.NoErr(t, err)
	byToken, err = s.SimpleFinConnectionsByTokenIDs(ctx, []int64{tokenID, emptyToken.ID.Int64()})
	if err != nil || len(byToken[tokenID]) != 1 || byToken[emptyToken.ID.Int64()] == nil || len(byToken[emptyToken.ID.Int64()]) != 0 {
		t.Fatalf("SimpleFinConnectionsByTokenIDs() = %#v, %v", byToken, err)
	}
	now := time.Now().UTC()
	reason := "TYPE"
	must.NoErr(t, s.SetSimpleFinConnectionHealth(ctx, connID, "SYNC_ERROR", &reason, now))
	next := now.Add(time.Hour)
	must.NoErr(t, s.SetSimpleFinTokenSynced(ctx, tokenID, now, next))
	must.NoErr(t, s.ResetSimpleFinTokenSyncedAt(ctx, tokenID))

	must.NoErr(t, s.DeleteSimpleFinAccessToken(ctx, tokenID))
	missing, err := s.SimpleFinAccessTokenByID(ctx, tokenID)
	if err != nil || missing != nil {
		t.Fatalf("SimpleFinAccessTokenByID() after delete = %#v, %v", missing, err)
	}
}
