package crawl

import (
	"encoding/json"
	"testing"
	"time"
)

func TestPolicyFallsBackWhenRowAndDefaultsAbsent(t *testing.T) {
	p, err := ParsePolicy(json.RawMessage("null"), Defaults{})
	if err != nil {
		t.Fatal(err)
	}
	if p.RequestInterval != fallbackRequestInterval || p.MaxDecksPerRun != fallbackMaxDecksPerRun {
		t.Fatalf("fallbacks not applied: %+v", p)
	}
	if p.RequestInterval != time.Second {
		t.Fatalf("expected 1s pace: %+v", p)
	}
}

func TestPolicyDefaultsComeFromTheSource(t *testing.T) {
	src := Defaults{RequestInterval: 3 * time.Second, MaxDecksPerRun: 1000}
	p, err := ParsePolicy(json.RawMessage("null"), src)
	if err != nil {
		t.Fatal(err)
	}
	if p.RequestInterval != 3*time.Second || p.MaxDecksPerRun != 1000 {
		t.Fatalf("source defaults lost: %+v", p)
	}
}

func TestPolicyOverridesOnlySetFields(t *testing.T) {
	src := Defaults{RequestInterval: 3 * time.Second, MaxDecksPerRun: 1000, BackfillDecks: 4000}
	p, err := ParsePolicy(json.RawMessage(`{"maxDecksPerRun": 25}`), src)
	if err != nil {
		t.Fatal(err)
	}
	if p.MaxDecksPerRun != 25 || p.BackfillDecks != 4000 || p.RequestInterval != 3*time.Second {
		t.Fatalf("partial override wrong: %+v", p)
	}
}

func TestPolicyBudgetBackfillsFirst(t *testing.T) {
	p := Defaults{}.Policy()
	if got := p.Budget(0); got != p.BackfillDecks {
		t.Fatalf("first run budget %d, want backfill %d", got, p.BackfillDecks)
	}
	if got := p.Budget(1); got != p.MaxDecksPerRun {
		t.Fatalf("daily budget %d, want maxDecksPerRun %d", got, p.MaxDecksPerRun)
	}
}

func TestPolicyRejectsGarbage(t *testing.T) {
	if _, err := ParsePolicy(json.RawMessage(`{"requestIntervalMs":"soon"}`), Defaults{}); err == nil {
		t.Fatal("a typed row should fail")
	}
}
