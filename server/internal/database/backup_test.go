package database

import (
	"path/filepath"
	"testing"
)

func TestBackupPlainDataPath(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "tallyo.db")
	tests := []struct {
		dst  string
		want string
	}{
		{dst: dir, want: filepath.Join(dir, "tallyo.plain.db")},
		{dst: filepath.Join(dir, "custom.db"), want: filepath.Join(dir, "custom.db")},
		{want: filepath.Join(dir, "tallyo.plain.db")},
	}
	for _, tc := range tests {
		got, err := BackupPlainDataPath(dbPath, tc.dst)
		if err != nil || got != tc.want {
			t.Errorf("BackupPlainDataPath(%q) = %q, %v; want %q, no error", tc.dst, got, err, tc.want)
		}
	}
	if _, err := BackupPlainDataPath(":memory:", ""); err == nil {
		t.Fatal("BackupPlainDataPath(:memory:) expected error")
	}
}
