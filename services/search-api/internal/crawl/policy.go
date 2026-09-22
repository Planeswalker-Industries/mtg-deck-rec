// Package crawl is the shared engine behind the deck crawlers (Moxfield, Archidekt): politeness, budget, fetching,
// the run loop and the Supabase REST store. A Source plugs in the two things that differ between sites - the URL to
// list decks by update and the parsing of a list and a deck - so nothing downstream sees which site a deck came from.
package crawl

import (
	"encoding/json"
	"time"
)

// Policy is a crawl's politeness and budget. Its fields are read from app_config at run start (key = source name);
// Defaults carries the baseline before the row overrides it, so a source's pace is sane even before the database is
// touched.
type Policy struct {
	RequestInterval time.Duration
	MaxDecksPerRun  int
	BackfillDecks   int
	BackoffStart    time.Duration
	BackoffMax      time.Duration
	// StaleClaim is how long a crawl's claim may sit untouched before another run may take it over. It has to be
	// comfortably longer than a real crawl (a backfill runs for hours at the polite pace) and short enough that a
	// container killed mid-run does not wedge the source until someone notices.
	StaleClaim time.Duration
}

// Defaults is a source's baseline policy. Zero fields fall back to the shared absolutes below, so a source only has
// to name what differs (Archidekt, for instance, needs a 3 s pace because 1 s drew 429s on 2026-09-14).
type Defaults struct {
	RequestInterval time.Duration
	MaxDecksPerRun  int
	BackfillDecks   int
	BackoffStart    time.Duration
	BackoffMax      time.Duration
	StaleClaim      time.Duration
}

const (
	fallbackRequestInterval = time.Second
	fallbackMaxDecksPerRun  = 500
	fallbackBackfillDecks   = 10_000
	fallbackBackoffStart    = 5 * time.Second
	fallbackBackoffMax      = 5 * time.Minute
	// Six hours: longer than a 10,000-deck backfill at a 3 s pace (about eight and a half hours is the worst case,
	// but a crawl that long is already over its budget), and far shorter than "until someone reads the logs".
	fallbackStaleClaim = 6 * time.Hour
)

// Policy applies the defaults then fills any zero field from the shared fallbacks.
func (d Defaults) Policy() Policy {
	p := Policy{
		RequestInterval: d.RequestInterval,
		MaxDecksPerRun:  d.MaxDecksPerRun,
		BackfillDecks:   d.BackfillDecks,
		BackoffStart:    d.BackoffStart,
		BackoffMax:      d.BackoffMax,
		StaleClaim:      d.StaleClaim,
	}
	if p.RequestInterval <= 0 {
		p.RequestInterval = fallbackRequestInterval
	}
	if p.MaxDecksPerRun <= 0 {
		p.MaxDecksPerRun = fallbackMaxDecksPerRun
	}
	if p.BackfillDecks <= 0 {
		p.BackfillDecks = fallbackBackfillDecks
	}
	if p.BackoffStart <= 0 {
		p.BackoffStart = fallbackBackoffStart
	}
	if p.BackoffMax <= 0 {
		p.BackoffMax = fallbackBackoffMax
	}
	if p.StaleClaim <= 0 {
		p.StaleClaim = fallbackStaleClaim
	}
	return p
}

// ParsePolicy decodes the source's app_config row (key = source name) on top of its defaults.
func ParsePolicy(raw json.RawMessage, d Defaults) (Policy, error) {
	p := d.Policy()
	if len(raw) == 0 {
		return p, nil
	}
	var fields struct {
		RequestIntervalMs int `json:"requestIntervalMs"`
		MaxDecksPerRun    int `json:"maxDecksPerRun"`
		BackfillDecks     int `json:"backfillDecks"`
		BackoffStartMs    int `json:"backoffStartMs"`
		BackoffMaxMs      int `json:"backoffMaxMs"`
		StaleClaimSeconds int `json:"staleClaimSeconds"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return Policy{}, err
	}
	if fields.RequestIntervalMs > 0 {
		p.RequestInterval = time.Duration(fields.RequestIntervalMs) * time.Millisecond
	}
	if fields.MaxDecksPerRun > 0 {
		p.MaxDecksPerRun = fields.MaxDecksPerRun
	}
	if fields.BackfillDecks > 0 {
		p.BackfillDecks = fields.BackfillDecks
	}
	if fields.BackoffStartMs > 0 {
		p.BackoffStart = time.Duration(fields.BackoffStartMs) * time.Millisecond
	}
	if fields.BackoffMaxMs > 0 {
		p.BackoffMax = time.Duration(fields.BackoffMaxMs) * time.Millisecond
	}
	if fields.StaleClaimSeconds > 0 {
		p.StaleClaim = time.Duration(fields.StaleClaimSeconds) * time.Second
	}
	return p, nil
}

// Budget returns how many decks this run may fetch: the backfill allowance on the first crawl, otherwise the daily
// increment.
func (p Policy) Budget(existingDecks int) int {
	if existingDecks == 0 {
		return p.BackfillDecks
	}
	return p.MaxDecksPerRun
}
