package auth

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net"
	"strings"
	"tallyo/internal/utils/must"
	"testing"
	"time"
)

func TestSMTPSenderTimesOutOnSilentServer(t *testing.T) {
	host, port, _ := silentSMTPServer(t)
	sender := &SMTPSender{host: host, port: port, from: "from@example.com", Timeout: 200 * time.Millisecond}
	start := time.Now()
	err := sender.Send(context.Background(), "to@example.com", "subject", "body")
	if err == nil {
		t.Fatal("expected error from a silent SMTP server")
	}
	if elapsed := time.Since(start); elapsed > time.Second {
		t.Fatalf("Send() took %v, want bounded by the configured timeout", elapsed)
	}
}

func TestSMTPSenderCancellationInterruptsSilentServer(t *testing.T) {
	host, port, accepted := silentSMTPServer(t)
	sender := &SMTPSender{host: host, port: port, from: "from@example.com", Timeout: 5 * time.Second}
	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- sender.Send(ctx, "to@example.com", "subject", "body")
	}()
	<-accepted
	start := time.Now()
	cancel()
	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("expected cancellation error from silent SMTP server")
		}
		if elapsed := time.Since(start); elapsed > time.Second {
			t.Fatalf("Send() took %v after cancellation, want prompt return", elapsed)
		}
	case <-time.After(time.Second):
		t.Fatal("Send() did not return promptly after cancellation")
	}
}

func TestSMTPSenderSendsMessageSuccessfully(t *testing.T) {
	ln, host, port := smtpListener(t)
	received := make(chan string, 1)
	go runFakeSMTPServer(t, ln, received)
	sender := &SMTPSender{host: host, port: port, from: "from@example.com", Timeout: 5 * time.Second}
	must.NoErr(t, sender.Send(context.Background(), "to@example.com", "Hello", "Body text"))
	select {
	case msg := <-received:
		if !strings.Contains(msg, "Subject: Hello") || !strings.Contains(msg, "Body text") {
			t.Fatalf("received message missing expected content: %q", msg)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("fake SMTP server never received a message")
	}
}

func TestSMTPSenderRequiresTLSForAuthentication(t *testing.T) {
	ln, host, port := smtpListener(t)
	go runFakeSMTPServer(t, ln, make(chan string, 1))
	sender := &SMTPSender{host: host, port: port, from: "from@example.com", username: "user", password: "secret", Timeout: time.Second}
	if err := sender.Send(context.Background(), "to@example.com", "subject", "body"); err == nil {
		t.Fatal("authenticated SMTP accepted a plaintext connection")
	}
}

func smtpListener(t *testing.T) (net.Listener, string, string) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	must.NoErr(t, err)
	t.Cleanup(func() { _ = ln.Close() })
	host, port, _ := net.SplitHostPort(ln.Addr().String())
	return ln, host, port
}

func silentSMTPServer(t *testing.T) (string, string, <-chan struct{}) {
	t.Helper()
	ln, host, port := smtpListener(t)
	accepted := make(chan struct{})
	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		close(accepted)
		_, _ = io.Copy(io.Discard, conn)
	}()
	return host, port, accepted
}

func runFakeSMTPServer(t *testing.T, ln net.Listener, received chan<- string) {
	t.Helper()
	conn, err := ln.Accept()
	if err != nil {
		return
	}
	defer func() { _ = conn.Close() }()
	r := bufio.NewReader(conn)
	reply := func(line string) {
		if _, err := fmt.Fprintf(conn, "%s\r\n", line); err != nil {
			t.Errorf("fake smtp server write: %v", err)
		}
	}

	reply("220 fake.example.com ESMTP")
	_, _ = r.ReadString('\n')
	reply("250-fake.example.com")
	reply("250 OK")
	for range 2 {
		if _, err := r.ReadString('\n'); err != nil {
			return
		}
		reply("250 OK")
	}
	_, _ = r.ReadString('\n')
	reply("354 Start mail input")
	var body strings.Builder
	for line, err := r.ReadString('\n'); err == nil && strings.TrimSpace(line) != "."; line, err = r.ReadString('\n') {
		body.WriteString(line)
	}
	received <- body.String()
	reply("250 OK")
	_, _ = r.ReadString('\n')
	reply("221 Bye")
}
