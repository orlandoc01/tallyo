package graph

import (
	"context"
	"fmt"

	"github.com/99designs/gqlgen/graphql"
	"github.com/samber/lo"

	"tallyo/internal/graph/model"
)

func ConfigWithAuth(resolver ResolverRoot) Config {
	cfg := Config{Resolvers: resolver}
	cfg.Directives.RequiresScope = func(ctx context.Context, _ any, next graphql.Resolver, scope string) (any, error) {
		if err := requireScope(ctx, scope); err != nil {
			return nil, err
		}
		return next(ctx)
	}
	cfg.Directives.RequiresDynamicScope = func(ctx context.Context, _ any, next graphql.Resolver) (any, error) {
		return next(ctx)
	}
	cfg.Complexity.Query.Nodes = func(childComplexity int, ids []*model.GlobalID) int {
		childComplexity = max(childComplexity, 1)
		return lo.Ternary(len(ids) == 0, childComplexity, childComplexity*len(ids))
	}
	return cfg
}

func RequireOperationScope(ctx context.Context, typeName, fieldName string) error {
	scope, err := OperationScope(typeName, fieldName)
	if err != nil {
		return err
	}
	return requireScope(ctx, scope)
}

func OperationScope(typeName, fieldName string) (string, error) {
	typeDef := parsedSchema.Types[typeName]
	if typeDef == nil {
		return "", fmt.Errorf("schema type %q not found", typeName)
	}
	field := typeDef.Fields.ForName(fieldName)
	if field == nil {
		return "", fmt.Errorf("schema field %s.%s not found", typeName, fieldName)
	}
	directive := field.Directives.ForName("requiresScope")
	if directive == nil {
		return "", fmt.Errorf("schema field %s.%s missing @requiresScope", typeName, fieldName)
	}
	arg := directive.Arguments.ForName("scope")
	if arg == nil || arg.Value == nil || arg.Value.Raw == "" {
		return "", fmt.Errorf("schema field %s.%s missing @requiresScope(scope: ...)", typeName, fieldName)
	}
	return arg.Value.Raw, nil
}
