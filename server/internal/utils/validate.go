package utils

import (
	"reflect"
	"strings"

	"github.com/go-playground/validator/v10"
	validators "github.com/go-playground/validator/v10/non-standard/validators"
	"github.com/samber/lo"
)

// Validator is a shared, pre-configured validator instance. It registers JSON
// field names for error messages and the "notblank" tag (rejects whitespace-only
// strings) from the validator library's non-standard validators.
var Validator = func() *validator.Validate {
	v := validator.New(validator.WithRequiredStructEnabled())
	v.RegisterTagNameFunc(func(fld reflect.StructField) string {
		name, _, _ := strings.Cut(fld.Tag.Get("json"), ",")
		return lo.Ternary(name == "" || name == "-", fld.Name, name)
	})
	//nolint:errcheck
	v.RegisterValidation("notblank", validators.NotBlank)
	return v
}()
