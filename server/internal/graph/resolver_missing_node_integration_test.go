package graph

import (
	"testing"

	"tallyo/internal/graph/model"
)

func TestMissingNodesReturnPublicErrors(t *testing.T) {
	ctx := allScopesCtx()
	resolver, _ := testResolver(t)
	assertResolverErrors(t, map[string]error{
		"account":    resultErr(resolver.QueryAccount(ctx, model.New(model.GlobalIDAccount, 999999))),
		"connection": resultErr(resolver.UpdateConnection(ctx, model.UpdateConnectionInput{ConnectionID: model.New(model.GlobalIDConnection, 999999)})),
	})
}
