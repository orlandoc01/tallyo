package apierror

import "fmt"

const (
	CodeBadUserInput = "BAD_USER_INPUT"
	CodeForbidden    = "FORBIDDEN"
	CodeInternal     = "INTERNAL"

	InternalMessage = "internal error"
)

type Error struct {
	Message string
	Code    string
	Err     error
}

func New(message, code string) error {
	return &Error{Message: message, Code: code}
}

func Publicf(format string, args ...any) error {
	return New(fmt.Sprintf(format, args...), CodeBadUserInput)
}

func Public(err error) error {
	if err == nil {
		return nil
	}
	return &Error{Message: err.Error(), Code: CodeBadUserInput, Err: err}
}

func (e *Error) Error() string {
	return e.Message
}

func (e *Error) Unwrap() error {
	return e.Err
}
