package graph

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/99designs/gqlgen/graphql"
	"github.com/vektah/gqlparser/v2/ast"
	"github.com/vektah/gqlparser/v2/gqlerror"

	"tallyo/internal/apierror"
	"tallyo/internal/utils/test"
)

func TestSafeErrorPresenter(t *testing.T) {
	cases := []struct {
		name        string
		err         error
		wantMessage string
		wantCode    string
	}{
		{
			name:        "unknown error masked",
			err:         graphql.ErrorOnPath(context.Background(), errors.New("SELECT private_key_pem FROM signing_keys secret-token")),
			wantMessage: apierror.InternalMessage,
			wantCode:    apierror.CodeInternal,
		},
		{
			name:        "public resolver error preserved",
			err:         graphql.ErrorOnPath(context.Background(), apierror.Publicf("date must use YYYY-MM-DD")),
			wantMessage: "date must use YYYY-MM-DD",
			wantCode:    apierror.CodeBadUserInput,
		},
		{
			name:        "unknown type validation error masked",
			err:         &gqlerror.Error{Message: `Unknown type "Bogus".`},
			wantMessage: "invalid GraphQL request",
			wantCode:    apierror.CodeBadUserInput,
		},
		{
			name:        "unknown field validation error masked",
			err:         &gqlerror.Error{Message: `Cannot query field "bogus" on type "Query". Did you mean "budgets"?`},
			wantMessage: "invalid GraphQL request",
			wantCode:    apierror.CodeBadUserInput,
		},
		{
			name:        "unknown input field validation error masked",
			err:         &gqlerror.Error{Message: `Field "bogus" is not defined by type "TransactionsFilter". Did you mean "categoryIds"?`},
			wantMessage: "invalid GraphQL request",
			wantCode:    apierror.CodeBadUserInput,
		},
		{
			name:        "invalid enum validation error masked",
			err:         &gqlerror.Error{Message: `Value "BOGUS" does not exist in "TransactionSortField" enum.`},
			wantMessage: "invalid GraphQL request",
			wantCode:    apierror.CodeBadUserInput,
		},
		{
			name:        "missing required argument validation error masked",
			err:         &gqlerror.Error{Message: `Field "deleteTransaction" argument "id" of type "ID!" is required, but it was not provided.`},
			wantMessage: "invalid GraphQL request",
			wantCode:    apierror.CodeBadUserInput,
		},
		{
			name:        "internal path-bearing error masked, not returned unchanged",
			err:         &gqlerror.Error{Message: "SELECT private_key_pem FROM signing_keys", Path: ast.Path{ast.PathName("someField")}},
			wantMessage: apierror.InternalMessage,
			wantCode:    apierror.CodeInternal,
		},
	}

	present := SafeErrorPresenter(test.Logger)
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := present(context.Background(), tc.err)
			if got.Message != tc.wantMessage {
				t.Fatalf("Message = %q, want %q", got.Message, tc.wantMessage)
			}
			if got.Extensions["code"] != tc.wantCode {
				t.Fatalf("code = %#v, want %q", got.Extensions["code"], tc.wantCode)
			}
			lower := strings.ToLower(got.Message)
			if strings.Contains(lower, "bogus") || strings.Contains(lower, "signing_keys") || strings.Contains(lower, "did you mean") {
				t.Fatalf("message leaked schema/internal detail: %q", got.Message)
			}
		})
	}
}
