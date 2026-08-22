package accounts

import (
	"slices"
	"testing"
)

func TestNormalizeEVMChainIDs(t *testing.T) {
	got := NormalizeEVMChainIDs([]string{"op", "eth", "op", "arb"})
	want := []string{"arb", "eth", "op"}
	if !slices.Equal(got, want) {
		t.Fatalf("NormalizeEVMChainIDs() = %v, want %v", got, want)
	}
}

func TestValidateEVMChainIDs(t *testing.T) {
	for _, tt := range []struct {
		name     string
		chainIDs []string
		wantErr  bool
	}{
		{name: "known", chainIDs: []string{"eth", "base"}},
		{name: "empty", chainIDs: []string{}, wantErr: true},
		{name: "unknown", chainIDs: []string{"not-a-chain"}, wantErr: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateEVMChainIDs(tt.chainIDs)
			if (err != nil) != tt.wantErr {
				t.Fatalf("ValidateEVMChainIDs() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
