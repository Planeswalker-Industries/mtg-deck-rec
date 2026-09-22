package archidekt

import (
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// commanderFormat is Archidekt's format id for Commander. The browse feed is filtered on it, but the filter is not a
// guarantee, so the deck is checked against it too - the same stance as the worker's qualifyDeck.
const commanderFormat = 3

// deckSize is what a legal Commander deck holds, commander(s) included. A list that is not exactly this is a deck
// mid-edit or a variant format, and does not belong in the corpus.
const deckSize = 100

// deckResponse is the deck-detail API shape, pinned against testdata/deck-page.json. Cards arrive as entries with a
// nested card twice (edition and printing), and the oracle id lives at card.oracleCard.uid; a commander is an entry
// whose categories include "Commander".
type deckResponse struct {
	DeckFormat int    `json:"deckFormat"`
	Private    bool   `json:"private"`
	Unlisted   bool   `json:"unlisted"`
	UpdatedAt  string `json:"updatedAt"`
	// Category metadata decides which cards count as in-deck: categories the deck says are not in the deck
	// (sideboard, maybeboard, considering - or marked includedInDeck=false) are excluded, mirroring the worker's
	// qualifyDeck.
	Categories []deckCategory `json:"categories"`
	Cards      []struct {
		Quantity   int      `json:"quantity"`
		Categories []string `json:"categories"`
		DeletedAt  *string  `json:"deletedAt"`
		Card       *struct {
			OracleCard *struct {
				UID  string `json:"uid"`
				Name string `json:"name"`
			} `json:"oracleCard"`
		} `json:"card"`
	} `json:"cards"`
}

type deckCategory struct {
	Name           string `json:"name"`
	IncludedInDeck bool   `json:"includedInDeck"`
}

// Categories that mean a card is not part of the 100, whatever the deck's category metadata says.
var outsideDeck = map[string]bool{"sideboard": true, "maybeboard": true, "considering": true}

// ParseDeck extracts a deck and decides whether it belongs in the corpus.
//
// A deck that reads fine but is not a public 100-card Commander deck is a *crawl.NotQualified, which the run counts
// and moves past. The browse feed's own filters admit decks that are none of those things, which is why the worker
// checks them on the deck itself and this does too.
func ParseDeck(body []byte, id string) (crawl.Deck, error) {
	deck, meta, err := parseDeckBody(body, id)
	if err != nil {
		return crawl.Deck{}, err
	}
	if reason := disqualify(deck, meta); reason != "" {
		return crawl.Deck{}, &crawl.NotQualified{ID: id, Reason: reason}
	}
	return deck, nil
}

// deckMeta is what qualification needs that the deck itself does not carry.
type deckMeta struct {
	Format   int
	Private  bool
	Unlisted bool
}

// disqualify names the reason a parsed deck does not belong in the corpus, or "" when it does. Separate from the
// parse so each half can be tested on its own: the wire shape is pinned against a (trimmed) live fixture, and these
// rules are pinned against decks written to break them.
func disqualify(deck crawl.Deck, meta deckMeta) string {
	switch {
	case meta.Format != commanderFormat:
		return "not Commander format"
	case meta.Private || meta.Unlisted:
		return "not public"
	case len(deck.Commanders) == 0:
		return "no commander"
	case deck.Size != deckSize:
		return "not a 100-card deck"
	}
	return ""
}

// parseDeckBody reads the wire shape and nothing more: a failure here means the endpoint stopped looking like
// itself, which quarantines the run, while a deck that merely does not qualify parses perfectly well.
func parseDeckBody(body []byte, id string) (crawl.Deck, deckMeta, error) {
	var resp deckResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return crawl.Deck{}, deckMeta{}, &crawl.ShapeError{What: "deck", Detail: "not JSON: " + err.Error()}
	}
	if len(resp.Cards) == 0 {
		return crawl.Deck{}, deckMeta{}, &crawl.ShapeError{What: "deck", Detail: "no card entries"}
	}
	if resp.UpdatedAt == "" {
		return crawl.Deck{}, deckMeta{}, &crawl.ShapeError{What: "deck", Detail: "no update timestamp"}
	}
	meta := deckMeta{Format: resp.DeckFormat, Private: resp.Private, Unlisted: resp.Unlisted}

	excluded := excludedCategories(resp.Categories)
	deck := crawl.Deck{ID: id, Cards: map[string]int{}}
	commanders := map[string]string{} // oracle id to name, so a doubled commander entry stays one commander
	size := 0
	for _, entry := range resp.Cards {
		if entry.DeletedAt != nil {
			// Removed cards still sit in the list; they are not part of the deck.
			continue
		}
		// A card's first category decides where it lives, matching how Archidekt counts deck size. A card with no
		// category at all is in the deck: uncategorized is the default state of a card someone just added, and
		// dropping those would quietly write back a fraction of the list.
		if len(entry.Categories) > 0 && excluded(entry.Categories[0]) {
			continue
		}
		if entry.Card == nil || entry.Card.OracleCard == nil || entry.Card.OracleCard.UID == "" {
			return crawl.Deck{}, deckMeta{}, &crawl.ShapeError{What: "deck", Detail: "a card entry has no oracle id"}
		}
		quantity := entry.Quantity
		if quantity < 1 {
			quantity = 1
		}
		size += quantity

		oracleID := entry.Card.OracleCard.UID
		if isCommander(entry.Categories) {
			commanders[oracleID] = entry.Card.OracleCard.Name
			continue
		}
		// Copies of a card can arrive on separate entries (different printings of the same basic); they are the
		// same card, so the quantities add.
		deck.Cards[oracleID] += quantity
	}

	updated, err := parseTime(resp.UpdatedAt)
	if err != nil {
		return crawl.Deck{}, deckMeta{}, err
	}

	deck.UpdatedAt = updated
	deck.Size = size
	for oracleID := range commanders {
		deck.Commanders = append(deck.Commanders, oracleID)
	}
	sort.Strings(deck.Commanders)
	for _, oracleID := range deck.Commanders {
		deck.CommanderNames = append(deck.CommanderNames, commanders[oracleID])
	}
	return deck, meta, nil
}

// excludedCategories answers whether a card's primary category - the one Archidekt counts its quantity against -
// puts it outside the 100. Two ways in: the deck's own metadata says the category is not in the deck, or it is one
// of the boards Commander excludes by definition, which stand on their own because a deck can file a card under a
// board it never declared.
func excludedCategories(categories []deckCategory) func(primary string) bool {
	declared := map[string]bool{}
	for _, c := range categories {
		if !c.IncludedInDeck || outsideDeck[strings.ToLower(c.Name)] {
			declared[c.Name] = true
		}
	}
	return func(primary string) bool {
		return declared[primary] || outsideDeck[strings.ToLower(primary)]
	}
}

func isCommander(categories []string) bool {
	for _, c := range categories {
		if c == "Commander" {
			return true
		}
	}
	return false
}

func parseTime(s string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, &crawl.ShapeError{What: "deck", Detail: "unreadable update time " + s}
}
