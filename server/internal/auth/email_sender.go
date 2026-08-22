package auth

import (
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"net"
	"net/smtp"
	"time"

	"github.com/samber/lo"
)

type EmailSender interface {
	Send(ctx context.Context, to, subject, body string) error
}

func newEmailSender(cfg Config, log *slog.Logger) EmailSender {
	if cfg.SMTPHost == "" {
		return &LogSender{log: log}
	}
	return &SMTPSender{
		host:     cfg.SMTPHost,
		port:     cfg.SMTPPort,
		from:     cfg.SMTPFrom,
		username: cfg.SMTPUsername,
		password: cfg.SMTPPassword,
	}
}

type SMTPSender struct {
	host     string
	port     string
	from     string
	username string
	password string
	// Timeout bounds the entire connect+handshake+send exchange so a server
	// that accepts a socket but never speaks (no greeting, stalled DATA,
	// etc.) can't hang the caller indefinitely. Defaults to defaultSMTPTimeout.
	Timeout time.Duration
}

const defaultSMTPTimeout = 30 * time.Second

func (s *SMTPSender) timeout() time.Duration {
	return lo.Ternary(s.Timeout > 0, s.Timeout, defaultSMTPTimeout)
}

func (s *SMTPSender) Send(ctx context.Context, to, subject, body string) error {
	deadline := time.Now().Add(s.timeout())
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	addr := net.JoinHostPort(s.host, s.port)
	conn, err := (&net.Dialer{Deadline: deadline}).DialContext(ctx, "tcp", addr)
	if err != nil {
		return fmt.Errorf("dial smtp server: %w", err)
	}
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return fmt.Errorf("set smtp deadline: %w", err)
	}
	stopCancel := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stopCancel()

	client, err := smtp.NewClient(conn, s.host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("smtp handshake: %w", err)
	}
	defer func() { _ = client.Close() }()

	startTLS, _ := client.Extension("STARTTLS")
	if startTLS {
		if err := client.StartTLS(&tls.Config{ServerName: s.host}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if s.username != "" && !startTLS {
		return fmt.Errorf("smtp server does not support STARTTLS")
	}
	auth, _ := client.Extension("AUTH")
	if s.username != "" && !auth {
		return fmt.Errorf("smtp server does not support AUTH")
	}
	if s.username != "" {
		if err := client.Auth(smtp.PlainAuth("", s.username, s.password, s.host)); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}
	if err := client.Mail(s.from); err != nil {
		return fmt.Errorf("smtp mail from: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt to: %w", err)
	}
	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	msg := fmt.Appendf(nil, "From: %s\r\nTo: %s\r\nSubject: %s\r\n\r\n%s\r\n", s.from, to, subject, body)
	if _, err := w.Write(msg); err != nil {
		_ = w.Close()
		return fmt.Errorf("write smtp message: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("close smtp message: %w", err)
	}
	return client.Quit()
}

// LogSender is used when SMTP is not configured (development / local runs only).
// OTP codes and magic links are printed to stdout. Never use in production.
type LogSender struct {
	log *slog.Logger
}

func (s *LogSender) Send(_ context.Context, to, subject, body string) error {
	s.log.Info("email OTP (no SMTP configured — dev mode only)", "to", to, "subject", subject, "body", body)
	return nil
}
