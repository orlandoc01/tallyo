package graph

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/vektah/gqlparser/v2"
	"github.com/vektah/gqlparser/v2/ast"

	"tallyo/internal/auth"
	"tallyo/internal/utils/must"
)

func loadSchemaSources(t *testing.T) []*ast.Source {
	t.Helper()
	matches, err := filepath.Glob("../../../schema/*.graphql")
	if err != nil {
		t.Fatalf("glob schema files: %v", err)
	}
	if len(matches) == 0 {
		t.Fatal("no schema files found in schema/")
	}
	sources := make([]*ast.Source, 0, len(matches))
	for _, path := range matches {
		b, err := os.ReadFile(path)
		must.NoErr(t, err)
		sources = append(sources, &ast.Source{Name: filepath.Base(path), Input: string(b)})
	}
	return sources
}

func TestRootOperationScopeDirectives(t *testing.T) {
	schema, err := gqlparser.LoadSchema(loadSchemaSources(t)...)
	must.NoErr(t, err)

	validScopes := map[string]bool{}
	for _, scope := range auth.AllScopes {
		validScopes[scope] = true
	}

	for _, typeName := range []string{"Query", "Mutation"} {
		typeDef := schema.Types[typeName]
		if typeDef == nil {
			t.Fatalf("missing %s type", typeName)
		}
		for _, field := range typeDef.Fields {
			if strings.HasPrefix(field.Name, "__") {
				continue
			}
			if typeName == "Query" && (field.Name == "node" || field.Name == "nodes") {
				if directive := field.Directives.ForName("requiresDynamicScope"); directive == nil {
					t.Fatalf("Query.%s missing @requiresDynamicScope", field.Name)
				}
				if directive := field.Directives.ForName("requiresScope"); directive != nil {
					t.Fatalf("Query.%s must not use @requiresScope", field.Name)
				}
				continue
			}
			directive := field.Directives.ForName("requiresScope")
			if directive == nil {
				t.Fatalf("%s.%s missing @requiresScope", typeName, field.Name)
			}
			arg := directive.Arguments.ForName("scope")
			if arg == nil || arg.Value == nil {
				t.Fatalf("%s.%s missing @requiresScope(scope: ...)", typeName, field.Name)
			}
			if !validScopes[arg.Value.Raw] {
				t.Fatalf("%s.%s scope = %q is not in auth.AllScopes", typeName, field.Name, arg.Value.Raw)
			}
		}
	}
}

func TestRequireOperationScopeUsesSchemaDirective(t *testing.T) {
	if err := RequireOperationScope(context.Background(), "Query", "transactions"); err == nil {
		t.Fatal("expected missing scope to fail")
	}

	ctx := auth.ContextWithScopes(context.Background(), []string{auth.ScopeReadTransactions})
	must.NoErr(t, RequireOperationScope(ctx, "Query", "transactions"))

	scope, err := OperationScope("Mutation", "updateTransaction")
	must.NoErr(t, err)
	if scope != auth.ScopeWriteTransactions {
		t.Fatalf("OperationScope = %q, want %q", scope, auth.ScopeWriteTransactions)
	}

	scope, err = OperationScope("Query", "instanceTimezone")
	must.NoErr(t, err)
	if scope != auth.ScopeReadOwners {
		t.Fatalf("OperationScope(instanceTimezone) = %q, want %q", scope, auth.ScopeReadOwners)
	}

	scope, err = OperationScope("Mutation", "createSimpleFinAccessToken")
	must.NoErr(t, err)
	if scope != auth.ScopeWriteAccounts {
		t.Fatalf("OperationScope(createSimpleFinAccessToken) = %q, want %q", scope, auth.ScopeWriteAccounts)
	}
	must.NoErr(t, RequireOperationScope(auth.ContextWithScopes(context.Background(), []string{auth.ScopeWriteAccounts}), "Mutation", "createSimpleFinAccessToken"))
}
