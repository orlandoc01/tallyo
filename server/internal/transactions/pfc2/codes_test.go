package pfc2

import "testing"

func TestCodes(t *testing.T) {
	codes := Codes()
	if len(codes) == 0 {
		t.Fatal("expected non-empty PFC2 codes")
	}
	if !Valid(" food_and_drink_groceries ") {
		t.Fatal("expected valid normalized PFC2 code")
	}
	if Valid("NOT_A_PFC2_CODE") {
		t.Fatal("expected invalid PFC2 code")
	}
}

func TestNormalize(t *testing.T) {
	got := Normalize([]string{" food_and_drink_groceries ", "", "FOOD_AND_DRINK_GROCERIES", "OTHER_OTHER"})
	want := []string{"FOOD_AND_DRINK_GROCERIES", "OTHER_OTHER"}
	if len(got) != len(want) {
		t.Fatalf("Normalize length = %d, want %d (%#v)", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("Normalize[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}
