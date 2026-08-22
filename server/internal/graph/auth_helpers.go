package graph

import (
	"context"
	"fmt"

	"tallyo/internal/apierror"
	"tallyo/internal/auth"
)

func requireScope(ctx context.Context, scope string) error {
	if !auth.HasScope(ctx, scope) {
		return apierror.New(fmt.Sprintf("forbidden: %s access required", scope), apierror.CodeForbidden)
	}
	return nil
}
