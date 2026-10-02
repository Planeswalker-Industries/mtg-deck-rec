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
	if p.RequestInterval != fallbackRequestInterval || p.FirstVisitPages != fallbackFirstVisitPages {
		t.Fatalf("fallbacks not applied: %+v", p)
	}
	if p.RequestInterval != time.Second {
		t.Fatalf("expected 1s pace: %+v", p)
	}
}

func TestPolicyDefaultsComeFromTheSource(t *testing.T) {
	src := Defaults{RequestInterval: 3 * time.Second, NewDecksPerRevisit: 100}
	p, err := ParsePolicy(json.RawMessage("null"), src)
	if err != nil {
		t.Fatal(err)
	}
	if p.RequestInterval != 3*time.Second || p.NewDecksPerRevisit != 100 {
		t.Fatalf("source defaults lost: %+v", p)
	}
}

func TestPolicyOverridesOnlySetFields(t *testing.T) {
	src := Defaults{RequestInterval: 3 * time.Second, MaxPagesPerCommander: 40, FirstVisitPages: 1}
	p, err := ParsePolicy(json.RawMessage(`{"maxPagesPerCommander": 25, "runMinutes": 90, "requestJitterMs": 400}`), src)
	if err != nil {
		t.Fatal(err)
	}
	if p.MaxPagesPerCommander != 25 || p.FirstVisitPages != 1 || p.RequestInterval != 3*time.Second {
		t.Fatalf("partial override wrong: %+v", p)
	}
	if p.RunDuration != 90*time.Minute || p.RequestJitter != 400*time.Millisecond {
		t.Fatalf("runMinutes or requestJitterMs not read: %v, %v", p.RunDuration, p.RequestJitter)
	}
}

// A claim must outlast a run, or a second cron could take a live crawl's claim for stale.
func TestPolicyStaleClaimOutlastsARun(t *testing.T) {
	p := Defaults{}.Policy()
	if p.StaleClaim <= p.RunDuration {
		t.Fatalf("stale claim %v must be longer than a run %v", p.StaleClaim, p.RunDuration)
	}
}

func TestPolicyRejectsGarbage(t *testing.T) {
	if _, err := ParsePolicy(json.RawMessage(`{"requestIntervalMs":"soon"}`), Defaults{}); err == nil {
		t.Fatal("a typed row should fail")
	}
}
