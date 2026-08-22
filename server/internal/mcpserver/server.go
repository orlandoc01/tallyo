package mcpserver

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"tallyo/internal/apierror"
	"tallyo/internal/graph"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
	"github.com/samber/lo"
)

type Config struct {
	AllowedOrigins []string
	Logger         *slog.Logger
}

type Server struct {
	resolver *graph.Resolver
	log      *slog.Logger
}

func New(cfg Config, resolver *graph.Resolver) http.Handler {
	s := &Server{
		resolver: resolver,
		log:      cfg.Logger,
	}
	mcpSrv := mcpserver.NewMCPServer(
		"Tallyo",
		"1.0.0",
		mcpserver.WithInstructions(instructions),
		mcpserver.WithToolCapabilities(false),
		mcpserver.WithRecovery(),
		mcpserver.WithInputSchemaValidation(),
		mcpserver.WithStrictInputSchemaDefault(),
	)
	s.registerTools(mcpSrv)
	return mcpserver.NewStreamableHTTPServer(
		mcpSrv,
		mcpserver.WithEndpointPath("/mcp"),
		mcpserver.WithStateLess(false),
		mcpserver.WithSessionIdleTTL(30*time.Minute),
		mcpserver.WithStreamableHTTPCORS(mcpserver.WithCORSAllowedOrigins(s.corsOrigins(cfg.AllowedOrigins)...)),
	)
}

const instructions = "Personal finance tracker for a household. Amounts are USD; positive means money spent, negative means refund or credit. Spending reports exclude transfers and income unless a tool description says otherwise."

func (s *Server) corsOrigins(configured []string) []string {
	return lo.Ternary(len(configured) > 0, configured, []string{"https://claude.ai"})
}

func toolResult(value any, summary string) *mcp.CallToolResult {
	data, err := json.Marshal(value)
	if err != nil {
		return mcp.NewToolResultError(apierror.InternalMessage)
	}
	text := string(data)
	if summary != "" {
		text = fmt.Sprintf("%s\n%s", summary, text)
	}
	return mcp.NewToolResultStructured(value, text)
}
