package archidekt

import (
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

// ListURL is one page of a commander's decks, most viewed first: Commander format, 100-card decks. Archidekt's
// "page=N" pagination continues past its count cap of 1,000.
func (source) ListURL(commanderName string, page int) string { return listURL(commanderName, page) }

func (source) DeckURL(id string) string { return baseURL + deckPath + id + "/" }

func (source) ParseList(body []byte) (crawl.ListPage, error) { return ParseList(body) }

func (source) ParseDeck(body []byte, id string) (crawl.Deck, error) { return ParseDeck(body, id) }

// Defaults is the crawl policy before app_config.archidekt overrides it. One request a second plus up to half a
// second of jitter: the project's one-a-second rule (owner decision 2026-10-01). One a second drew 429s on
// 2026-09-14, so the fetcher's 429 backoff is what keeps this polite; if 429s return, raise requestIntervalMs in
// app_config rather than here. Everything else (run length, pages per commander) is the engine's.
func Defaults() crawl.Defaults {
	return crawl.Defaults{
		RequestInterval: time.Second,
		RequestJitter:   500 * time.Millisecond,
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
