package graph

import (
	"context"
	"strings"
	"testing"

	"tallyo/internal/auth"
	"tallyo/internal/graph/model"
)

func TestNodeRejectsUnknownType(t *testing.T) {
	id := model.New(model.GlobalIDType("Unknown"), 1)
	resolver := &Resolver{}
	if _, err := resolver.Node(auth.ContextWithScopes(context.Background(), auth.AllScopes), id); err == nil || !strings.Contains(err.Error(), "unsupported node type") {
		t.Fatalf("Node() error = %v, want unsupported node type", err)
	}
}

func TestNodesRejectsTooManyOrNilIDs(t *testing.T) {
	resolver := &Resolver{}
	tooMany := make([]*model.GlobalID, maxNodeIDs+1)
	for i := range tooMany {
		id := model.New(model.GlobalIDAccount, int64(i+1))
		tooMany[i] = &id
	}
	if _, err := resolver.Nodes(context.Background(), tooMany); err == nil || !strings.Contains(err.Error(), "at most") {
		t.Fatalf("Nodes(tooMany) error = %v, want cap error", err)
	}
	if _, err := resolver.Nodes(context.Background(), []*model.GlobalID{nil}); err == nil || !strings.Contains(err.Error(), "must not contain null") {
		t.Fatalf("Nodes(nil) error = %v, want nil error", err)
	}
}

func TestNodeChecksScopeBeforeFetch(t *testing.T) {
	resolver := &Resolver{}
	if _, err := resolver.Node(context.Background(), model.New(model.GlobalIDAccount, 1)); err == nil || !strings.Contains(err.Error(), auth.ScopeReadAccounts) {
		t.Fatalf("Node() error = %v, want missing account scope", err)
	}
	if _, err := resolver.Node(context.Background(), model.New(model.GlobalIDUser, 1)); err == nil || !strings.Contains(err.Error(), auth.ScopeReadUsers) {
		t.Fatalf("Node() error = %v, want missing read:users scope", err)
	}
}
