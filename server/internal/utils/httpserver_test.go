package utils

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

func TestServeUntilDoneWaitsForInFlightRequestBeforeReturning(t *testing.T) {
	started := make(chan struct{})
	handlerDone := make(chan struct{})
	serverReturned := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		time.Sleep(50 * time.Millisecond)
		select {
		case <-serverReturned:
			t.Error("ServeUntilDone returned before the in-flight handler exited")
		default:
		}
		w.WriteHeader(http.StatusOK)
		close(handlerDone)
	})}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan error, 1)
	go func() {
		doneCh <- serveUntilDone(ctx, server, ln, 2*time.Second)
		close(serverReturned)
	}()

	respCh := make(chan int, 1)
	go func() {
		resp, err := http.Get("http://" + ln.Addr().String())
		if err != nil {
			t.Errorf("client request: %v", err)
			return
		}
		defer func() { _ = resp.Body.Close() }()
		respCh <- resp.StatusCode
	}()

	<-started
	cancel()

	select {
	case status := <-respCh:
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
	case <-time.After(time.Second):
		t.Fatal("client never received a response — shutdown likely killed the in-flight request")
	}

	select {
	case <-handlerDone:
	default:
		t.Fatal("handler did not complete before the response was received")
	}

	select {
	case <-serverReturned:
		if err := <-doneCh; err != nil {
			t.Fatalf("serveUntilDone() error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("serveUntilDone did not return after handler completion")
	}

	select {
	case <-handlerDone:
	default:
		t.Fatal("ServeUntilDone returned before handler completion")
	}
}

func TestServeUntilDoneReturnsShutdownTimeoutError(t *testing.T) {
	release := make(chan struct{})
	started := make(chan struct{})
	t.Cleanup(func() { close(release) })
	server := &http.Server{Handler: http.HandlerFunc(func(_ http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
	})}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	doneCh := make(chan error, 1)
	go func() { doneCh <- serveUntilDone(ctx, server, ln, 50*time.Millisecond) }()

	go func() {
		resp, err := http.Get("http://" + ln.Addr().String())
		if err == nil {
			_ = resp.Body.Close()
		}
	}()
	<-started
	cancel()

	select {
	case err := <-doneCh:
		if err == nil {
			t.Fatal("expected a shutdown timeout error")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serveUntilDone did not return after the shutdown timeout elapsed")
	}
}
