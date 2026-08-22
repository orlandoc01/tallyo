package graph

import (
	"context"
	"log/slog"
	"time"

	"github.com/99designs/gqlgen/graphql"
)

func OperationLogger(logger *slog.Logger) graphql.OperationMiddleware {
	return func(ctx context.Context, next graphql.OperationHandler) graphql.ResponseHandler {
		oc := graphql.GetOperationContext(ctx)
		name := oc.OperationName
		opType := ""
		if oc.Operation != nil {
			opType = string(oc.Operation.Operation)
		}
		start := time.Now()
		nextHandler := next(ctx)
		return func(ctx context.Context) *graphql.Response {
			resp := nextHandler(ctx)
			args := []any{
				"operation", name,
				"type", opType,
				"duration", time.Since(start),
			}
			if resp != nil && len(resp.Errors) > 0 {
				logger.Error("graphql operation", append(args, "errors", resp.Errors)...)
			} else {
				logger.Info("graphql operation", args...)
			}
			return resp
		}
	}
}
