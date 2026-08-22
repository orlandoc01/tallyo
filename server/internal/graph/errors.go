package graph

import (
	"context"
	"errors"
	"log/slog"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2/gqlerror"

	"tallyo/internal/apierror"
)

func SafeErrorPresenter(logger *slog.Logger) func(context.Context, error) *gqlerror.Error {
	return func(ctx context.Context, err error) *gqlerror.Error {
		if publicErr, ok := errors.AsType[*apierror.Error](err); ok {
			presented := graphql.DefaultErrorPresenter(ctx, err)
			presented.Message = publicErr.Message
			presented.Extensions = map[string]any{"code": publicErr.Code}
			return presented
		}

		if gqlErr, ok := errors.AsType[*gqlerror.Error](err); ok && gqlErr.Err == nil && len(gqlErr.Path) == 0 {
			presented := graphql.DefaultErrorPresenter(ctx, err)
			presented.Message = "invalid GraphQL request"
			presented.Extensions = map[string]any{"code": apierror.CodeBadUserInput}
			return presented
		}

		logger.ErrorContext(ctx, "graphql error", "error", err)
		presented := graphql.DefaultErrorPresenter(ctx, err)
		presented.Message = apierror.InternalMessage
		presented.Extensions = map[string]any{"code": apierror.CodeInternal}
		return presented
	}
}

func SafeRecoverFunc(logger *slog.Logger) func(context.Context, any) error {
	return func(ctx context.Context, recovered any) error {
		logger.ErrorContext(ctx, "graphql panic", "panic", recovered)
		return apierror.New(apierror.InternalMessage, apierror.CodeInternal)
	}
}
