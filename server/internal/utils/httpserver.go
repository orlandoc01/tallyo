package utils

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

// ServeUntilDone serves server on a listener bound to server.Addr and blocks
// until ctx is cancelled or the server stops on its own, then synchronously
// shuts the server down (bounded by shutdownTimeout) before returning. This
// guarantees graceful shutdown completes — in-flight requests drain — before
// the caller releases any resource (e.g. a database) requests might still use.
func ServeUntilDone(ctx context.Context, server *http.Server, shutdownTimeout time.Duration) error {
	ln, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	return serveUntilDone(ctx, server, ln, shutdownTimeout)
}

func serveUntilDone(ctx context.Context, server *http.Server, ln net.Listener, shutdownTimeout time.Duration) error {
	serveErrCh := make(chan error, 1)
	go func() { serveErrCh <- server.Serve(ln) }()

	var serveErr error
	select {
	case serveErr = <-serveErrCh:
	case <-ctx.Done():
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown http server: %w", errors.Join(err, server.Close()))
	}
	if serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
		return serveErr
	}
	return nil
}
