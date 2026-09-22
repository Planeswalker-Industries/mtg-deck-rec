package moxfield

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/supabase"
)

// The Moxfield side of the shared crawl engine: URLs and parsers. Built, but blocked (Cloudflare WAF, 2026-09-22) -
// the first crawl contact disables the source, so wiring it up is harmless while the wall is up.

const Name = "moxfield"

const (
	baseURL      = "https://moxfield.com" // www redirects here; crawl the apex so links match the store's slugs
	deckListPath = "/decks/all"           // the browse feed, newest-update-first; query shape is a Slice 3a pin
	deckPath     = "/decks/"
)

// source implements crawl.Source. It is stateless: the run loop owns the order and the budget.
type source struct{}

func (source) Name() string { return Name }

func (source) ListURL(page int) string {
	return baseURL + deckListPath + fmt.Sprintf("?orderBy=updated&page=%d", page)
}

func (source) DeckURL(id string) string { return baseURL + deckPath + id }

func (source) ParseList(body []byte) ([]crawl.Entry, error) {
	parsed, err := ParseListPage(body)
	if err != nil {
		return nil, err
	}
	entries := make([]crawl.Entry, len(parsed))
	for i, e := range parsed {
		entries[i] = crawl.Entry{ID: e.Slug}
	}
	return entries, nil
}

func (source) ParseDeck(body []byte, id string) (crawl.Deck, error) {
	parsed, err := ParseDeckPage(body, id)
	if err != nil {
		return crawl.Deck{}, err
	}
	return crawl.Deck{
		ID:             id,
		CommanderNames: parsed.CommanderNames,
		Commanders:     parsed.Commanders,
		Cards:          parsed.Cards,
		Size:           parsed.Size,
		UpdatedAt:      parsed.UpdatedAt,
	}, nil
}

// Defaults is the crawl policy before app_config.moxfield overrides it.
func Defaults() crawl.Defaults {
	return crawl.Defaults{
		RequestInterval: time.Second,
		MaxDecksPerRun:  500,
		BackfillDecks:   10_000,
		BackoffStart:    5 * time.Second,
		BackoffMax:      5 * time.Minute,
	}
}

// NewRunner builds the Moxfield crawl: a fetcher for its host, the Supabase store bound to the source, and the
// shared run loop. Returns nil store wiring errors are the caller's; nothing here can fail at construction.
func NewRunner(sc *supabase.Client, log *slog.Logger, clientID string) *crawl.Runner {
	policy := Defaults().Policy()
	getter := crawl.NewFetcher([]string{"moxfield.com", "www.moxfield.com"}, policy, log)
	store := crawl.NewSupabaseStore(sc, Name, Defaults())
	return crawl.NewRunner(source{}, getter, store, log, clientID)
}
