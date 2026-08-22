package mcpserver

import (
	"encoding/json"
	"testing"

	mcpserver "github.com/mark3labs/mcp-go/server"
	"tallyo/internal/utils/must"
)

func TestRegisteredToolsMarshalInputSchema(t *testing.T) {
	srv := &Server{}
	mcpSrv := mcpserver.NewMCPServer("test", "0.0.0")
	srv.registerTools(mcpSrv)

	for name, tool := range mcpSrv.ListTools() {
		if _, err := json.Marshal(tool.Tool); err != nil {
			t.Errorf("marshal tool %s: %v", name, err)
		}
	}
}

func TestListTransactionsSchemaUsesStringsForCustomScalars(t *testing.T) {
	srv := &Server{}
	mcpSrv := mcpserver.NewMCPServer("test", "0.0.0")
	srv.registerTools(mcpSrv)

	tool := mcpSrv.GetTool("list_transactions")
	if tool == nil {
		t.Fatal("list_transactions tool not registered")
	}

	var schema map[string]any
	must.NoErr(t, json.Unmarshal(tool.Tool.RawInputSchema, &schema))

	filter := schemaProp(t, schema, "filter")
	datetimeRange := schemaProp(t, filter, "datetimeRange")
	from := schemaProp(t, datetimeRange, "from")
	assertSchemaTypeIncludes(t, "filter.datetimeRange.from", from, "string")

	categoryIds := schemaProp(t, filter, "categoryIds")
	items, ok := categoryIds["items"].(map[string]any)
	if !ok {
		t.Fatalf("filter.categoryIds: missing items schema, got %v", categoryIds)
	}
	assertSchemaTypeIncludes(t, "filter.categoryIds[]", items, "string")
}

func schemaProp(t *testing.T, schema map[string]any, name string) map[string]any {
	t.Helper()
	props, ok := schema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema has no properties: %v", schema)
	}
	prop, ok := props[name].(map[string]any)
	if !ok {
		t.Fatalf("schema missing property %q: %v", name, props)
	}
	return prop
}

func assertSchemaTypeIncludes(t *testing.T, path string, schema map[string]any, want string) {
	t.Helper()
	switch v := schema["type"].(type) {
	case string:
		if v != want {
			t.Errorf("%s: type = %q, want %q", path, v, want)
		}
	case []any:
		for _, candidate := range v {
			if candidate == want {
				return
			}
		}
		t.Errorf("%s: type = %v, want it to include %q", path, v, want)
	default:
		t.Errorf("%s: schema has no usable type field: %v", path, schema)
	}
}
