package mcpserver

import (
	"encoding/json"
	"fmt"
	"reflect"

	"tallyo/internal/graph/model"
	"tallyo/internal/money"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/mark3labs/mcp-go/mcp"
)

// scalarTypeSchemas overrides JSON Schema inference for custom GraphQL scalars
// that reflection would otherwise expose as object-shaped Go structs.
var scalarTypeSchemas = map[reflect.Type]*jsonschema.Schema{
	reflect.TypeFor[model.GlobalID](): {Type: "string", Description: "Opaque global ID, as returned by other tool calls."},
	reflect.TypeFor[money.Cents]():    {Type: "number", Description: "USD amount in dollars, e.g. 12.34."},
}

// withInputSchema generates the MCP input schema for T, correcting for the
// custom scalars in scalarTypeSchemas. Schema generation is static per type,
// so a failure here is a programming error (an unsupported field type) and
// panics at tool-registration time rather than producing a broken schema.
func withInputSchema[T any]() mcp.ToolOption {
	schema, err := jsonschema.For[T](&jsonschema.ForOptions{
		IgnoreInvalidTypes: true,
		TypeSchemas:        scalarTypeSchemas,
	})
	if err != nil {
		panic(fmt.Errorf("mcpserver: generating input schema for %T: %w", *new(T), err))
	}
	raw, err := json.Marshal(schema)
	if err != nil {
		panic(fmt.Errorf("mcpserver: marshaling input schema for %T: %w", *new(T), err))
	}
	return func(tool *mcp.Tool) {
		tool.InputSchema.Type = ""
		tool.RawInputSchema = raw
	}
}
