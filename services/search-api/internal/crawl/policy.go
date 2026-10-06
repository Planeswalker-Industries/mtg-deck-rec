// Package crawl is the shared engine behind the deck crawlers (Moxfield, Archidekt): politeness, budget, fetching,
// the run loop and the Supabase REST store. A Source plugs in the two things that differ between sites - the URL to
// list one commander's decks and the parsing of a list and a deck - so nothing downstream sees which site a deck came
// from.
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
	// RequestJitter adds a random extra wait of up to this much to each interval, so requests do not land on a fixed
	// beat. It only ever lengthens the gap: the interval stays the floor.
	RequestJitter time.Duration
	BackoffStart  time.Duration
	BackoffMax    time.Duration
	// StaleClaim is how long a crawl's claim may sit untouched before another run may take it over. It has to be
	// longer than RunDuration, or a second cron could seize a live claim, and short enough that a container killed
	// mid-run does not wedge the source until someone notices.
	StaleClaim time.Duration
	// RunDuration is how long one run may crawl: the daily allowance. The commander being visited when it runs out is
	// left partial and comes back first next time.
	RunDuration time.Duration
	// FirstVisitPages is how many list pages a commander's first visit reads.
	FirstVisitPages int
	// RevisitNewDecks is how a revisit grows a commander's sample (owner rule 2026-10-05). A revisit reads page 1 whole,
	// fetching every deck that is new or whose listed update time moved; if fewer than this many were fetched, it
	// reads on, page by page, until this many were or the list ends. Every deck fetched because it was new or changed
	// counts, whichever commander leads it, so this also bounds a revisit's deck requests past page 1.
	RevisitNewDecks int
	// MaxPagesPerCommander is the absolute ceiling on one visit's pages, whatever the two settings above ask for.
	MaxPagesPerCommander int
	// MaxFetchesPerCommander caps the deck fetches one visit may make. The page cap alone does not bound the work: at
	// 60 decks a page, forty pages is 2,400 fetches, which at the polite pace is hours - one commander could take a
	// whole run.
	MaxFetchesPerCommander int
	// RequestIntervalMax is the slowest the pace may become while the source is pushing back. The interval doubles on
	// a 429 up to this, and returns to RequestInterval after PaceRecoverRequests clean responses.
	RequestIntervalMax time.Duration
	// PaceRecoverRequests is how many requests must come back without a 429 before the pace returns to its base.
	PaceRecoverRequests int
}

// Defaults is a source's baseline policy. Zero fields fall back to the shared absolutes below, so a source only has
// to name what differs (Archidekt, for instance, needs a slower pace because one request a second drew 429s on 2026-09-14).
type Defaults struct {
	RequestInterval        time.Duration
	RequestJitter          time.Duration
	BackoffStart           time.Duration
	BackoffMax             time.Duration
	StaleClaim             time.Duration
	RunDuration            time.Duration
	FirstVisitPages        int
	RevisitNewDecks        int
	MaxPagesPerCommander   int
	MaxFetchesPerCommander int
	RequestIntervalMax     time.Duration
	PaceRecoverRequests    int
}

const (
	fallbackRequestInterval = time.Second
	fallbackBackoffStart    = 5 * time.Second
	fallbackBackoffMax      = 5 * time.Minute
	// Six hours a day: the owner's allowance for the crawl (2026-10-01).
	fallbackRunDuration = 6 * time.Hour
	// Two hours past a full run: long enough that a live claim is never taken for stale, and far shorter than
	// "until someone reads the logs".
	fallbackStaleClaim = 8 * time.Hour
	// One page (up to 60 decks on Archidekt) gives every commander a small base before any gets more (owner decision
	// 2026-10-01); later visits grow it.
	fallbackFirstVisitPages = 1
	// 25 new or changed decks a revisit (owner rule 2026-10-05). Page 1 alone, the rule before it (2026-10-03), grew a
	// sample only as decks entered the top 60 by views: no commander passed 93 decks. The 350-new-decks target before
	// that walked pages hunting decks that were not there; 25, counting every deck fetched, stays small.
	fallbackRevisitNewDecks = 25
	// 120 fetches is two pages' worth: enough for a visit that wants to grow a commander's sample, far short of the
	// hours a 40-page walk costs.
	fallbackMaxFetchesPerCommander = 120
	// Eight seconds is where the pace stops doubling. Past it the crawl is barely moving, and a source still saying no
	// at eight seconds a request is saying something a slower pace will not fix.
	fallbackRequestIntervalMax = 8 * time.Second
	// Sixty clean responses before trying the base pace again - about a minute of quiet at one request a second. Short
	// enough to recover within a run, long enough that it is not re-testing the limit every few requests.
	fallbackPaceRecoverRequests = 60
	// The worker's own per-commander page cap (serve:commander-requests): 2,400 listings at 60 a page.
	fallbackMaxPagesPerCommander = 40
)

// Policy applies the defaults then fills any zero field from the shared fallbacks.
func (d Defaults) Policy() Policy {
	return Policy{
		RequestInterval:        orDuration(d.RequestInterval, fallbackRequestInterval),
		RequestJitter:          d.RequestJitter,
		BackoffStart:           orDuration(d.BackoffStart, fallbackBackoffStart),
		BackoffMax:             orDuration(d.BackoffMax, fallbackBackoffMax),
		StaleClaim:             orDuration(d.StaleClaim, fallbackStaleClaim),
		RunDuration:            orDuration(d.RunDuration, fallbackRunDuration),
		FirstVisitPages:        orInt(d.FirstVisitPages, fallbackFirstVisitPages),
		RevisitNewDecks:        orInt(d.RevisitNewDecks, fallbackRevisitNewDecks),
		MaxPagesPerCommander:   orInt(d.MaxPagesPerCommander, fallbackMaxPagesPerCommander),
		MaxFetchesPerCommander: orInt(d.MaxFetchesPerCommander, fallbackMaxFetchesPerCommander),
		RequestIntervalMax:     orDuration(d.RequestIntervalMax, fallbackRequestIntervalMax),
		PaceRecoverRequests:    orInt(d.PaceRecoverRequests, fallbackPaceRecoverRequests),
	}
}

func orDuration(v, fallback time.Duration) time.Duration {
	if v > 0 {
		return v
	}
	return fallback
}

func orInt(v, fallback int) int {
	if v > 0 {
		return v
	}
	return fallback
}

// ParsePolicy decodes the source's app_config row (key = source name) on top of its defaults. A field the row leaves
// out or sets to zero keeps the default.
func ParsePolicy(raw json.RawMessage, d Defaults) (Policy, error) {
	p := d.Policy()
	if len(raw) == 0 {
		return p, nil
	}
	var fields struct {
		RequestIntervalMs      int `json:"requestIntervalMs"`
		RequestJitterMs        int `json:"requestJitterMs"`
		BackoffStartMs         int `json:"backoffStartMs"`
		BackoffMaxMs           int `json:"backoffMaxMs"`
		StaleClaimSeconds      int `json:"staleClaimSeconds"`
		RunMinutes             int `json:"runMinutes"`
		FirstVisitPages        int `json:"firstVisitPages"`
		RevisitNewDecks        int `json:"revisitNewDecks"`
		MaxFetchesPerCommander int `json:"maxFetchesPerCommander"`
		RequestIntervalMaxMs   int `json:"requestIntervalMaxMs"`
		PaceRecoverRequests    int `json:"paceRecoverRequests"`
		MaxPagesPerCommander   int `json:"maxPagesPerCommander"`
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return Policy{}, err
	}
	p.RequestInterval = orDuration(time.Duration(fields.RequestIntervalMs)*time.Millisecond, p.RequestInterval)
	p.RequestJitter = orDuration(time.Duration(fields.RequestJitterMs)*time.Millisecond, p.RequestJitter)
	p.BackoffStart = orDuration(time.Duration(fields.BackoffStartMs)*time.Millisecond, p.BackoffStart)
	p.BackoffMax = orDuration(time.Duration(fields.BackoffMaxMs)*time.Millisecond, p.BackoffMax)
	p.StaleClaim = orDuration(time.Duration(fields.StaleClaimSeconds)*time.Second, p.StaleClaim)
	p.RunDuration = orDuration(time.Duration(fields.RunMinutes)*time.Minute, p.RunDuration)
	p.FirstVisitPages = orInt(fields.FirstVisitPages, p.FirstVisitPages)
	p.RevisitNewDecks = orInt(fields.RevisitNewDecks, p.RevisitNewDecks)
	p.MaxFetchesPerCommander = orInt(fields.MaxFetchesPerCommander, p.MaxFetchesPerCommander)
	p.RequestIntervalMax = orDuration(time.Duration(fields.RequestIntervalMaxMs)*time.Millisecond, p.RequestIntervalMax)
	p.PaceRecoverRequests = orInt(fields.PaceRecoverRequests, p.PaceRecoverRequests)
	p.MaxPagesPerCommander = orInt(fields.MaxPagesPerCommander, p.MaxPagesPerCommander)
	return p, nil
}
