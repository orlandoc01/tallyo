package graph

import (
	"context"
	"testing"

	"tallyo/internal/graph/model"
	"tallyo/internal/utils/must"
)

func TestAccountTypeLocked(t *testing.T) {
	resolver := (&Resolver{}).Account().(*accountResolver)
	tests := []struct {
		name    string
		account *model.Account
		want    bool
	}{
		{name: "property", account: &model.Account{Type: model.AccountTypeProperty}, want: true},
		{name: "linked crypto wallet", account: &model.Account{Type: model.AccountTypeCryptoWallet}, want: true},
		{name: "manual crypto wallet", account: &model.Account{Type: model.AccountTypeCryptoWallet, Manual: true}, want: false},
		{name: "linked depository", account: &model.Account{Type: model.AccountTypeDepository}, want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolver.TypeLocked(context.Background(), tt.account)
			must.NoErr(t, err)
			if got != tt.want {
				t.Fatalf("TypeLocked = %t, want %t", got, tt.want)
			}
		})
	}
}
