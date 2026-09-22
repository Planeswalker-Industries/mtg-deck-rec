package archidekt

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/supabase"
)

// The Archidekt side of the shared crawl engine: URLs and parsers. It reads the public API (deck list v3 + deck
// detail), which the project's own worker has used since 2026-09-14 with Archidekt staff's blessing; staff ask for a
// link back where the data is published and warn that heavy use could get the API locked down, so the pace matters.

const Name = "archidekt"

const (
	baseURL  = "https://archidekt.com"
	listPath = "/api/decks/v3/"
	deckPath = "/api/decks/"
)

// source implements crawl.Source. It is stateless: the run loop owns the order and the budget.
type source struct{}

func (source) Name() string { return Name }

// ListURL is the browse feed, newest-update-first: Commander format, exactly 100 cards, ordered by update. What the
// page numbers mean is Archidekt's "page=N" pagination, which continues past the count cap.
func (source) ListURL(page int) string {
	return baseURL + listPath + "?" + listURLQuery + fmt.Sprintf("%d", page)
}

func (source) DeckURL(id string) string { return baseURL + deckPath + id + "/" }

func (source) ParseList(body []byte) ([]crawl.Entry, error) { return ParseList(body) }

func (source) ParseDeck(body []byte, id string) (crawl.Deck, error) { return ParseDeck(body, id) }

// Defaults is the crawl policy before app_config.archidekt overrides it. The 3 s pace is the worker's default: one
// request a second drew 429s on 2026-09-14.
func Defaults() crawl.Defaults {
	return crawl.Defaults{
		RequestInterval: 3 * time.Second,
		MaxDecksPerRun:  1000,
		BackfillDecks:   10_000,
		BackoffStart:    5 * time.Second,
		BackoffMax:      5 * time.Minute,
	}
}

// NewRunner builds the Archidekt crawl: a fetcher for its host, the Supabase store bound to the source, and the
// shared run loop.
func NewRunner(sc *supabase.Client, log *slog.Logger, clientID string) *crawl.Runner {
	getter := crawl.NewFetcher([]string{"archidekt.com", "www.archidekt.com"}, Defaults().Policy(), log)
	store := crawl.NewSupabaseStore(sc, Name, Defaults())
	return crawl.NewRunner(source{}, getter, store, log, clientID)
}
