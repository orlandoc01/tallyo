package graph

import (
	"context"
	"testing"

	testutil "tallyo/internal/utils/test"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2/ast"
)

func TestOperationLoggerWrapsHandler(t *testing.T) {
	ctx := graphql.WithOperationContext(context.Background(), &graphql.OperationContext{
		OperationName: "TestQuery",
		Operation:     &ast.OperationDefinition{Operation: ast.Query},
	})
	middleware := OperationLogger(testutil.Logger)
	handler := middleware(ctx, func(ctx context.Context) graphql.ResponseHandler {
		return func(ctx context.Context) *graphql.Response { return &graphql.Response{} }
	})
	if response := handler(ctx); response == nil {
		t.Fatalf("expected response")
	}
}
