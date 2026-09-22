package archidekt

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

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
	Categories []struct {
		Name           string `json:"name"`
		IncludedInDeck bool   `json:"includedInDeck"`
	} `json:"categories"`
	Cards []struct {
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

// Categories that mean a card is not part of the 100, whatever the deck's category metadata says.
var outsideDeck = map[string]bool{"sideboard": true, "maybeboard": true, "considering": true}

// ParseDeck extracts a deck: commander(s) and the other in-deck cards, oracle-level, plus its update time.
func ParseDeck(body []byte, id string) (crawl.Deck, error) {
	var resp deckResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return crawl.Deck{}, &crawl.ShapeError{What: "deck", Detail: "not JSON: " + err.Error()}
	}
	if len(resp.Cards) == 0 {
		return crawl.Deck{}, &crawl.ShapeError{What: "deck", Detail: "no card entries"}
	}
	if resp.UpdatedAt == "" {
		return crawl.Deck{}, &crawl.ShapeError{What: "deck", Detail: "no update timestamp"}
	}

	excluded := excludedCategories(resp.Categories)
	deck := crawl.Deck{ID: id}
	seen := map[string]bool{}
	for _, entry := range resp.Cards {
		if entry.DeletedAt != nil {
			// Removed cards still sit in the list; they are not part of the deck.
			continue
		}
		if len(entry.Categories) == 0 {
			continue
		}
		if excluded[entry.Categories[0]] {
			continue
		}
		if entry.Card == nil || entry.Card.OracleCard == nil || entry.Card.OracleCard.UID == "" {
			return crawl.Deck{}, &crawl.ShapeError{What: "deck", Detail: "a card entry has no oracle id"}
		}
		oracleID := entry.Card.OracleCard.UID
		if seen[oracleID] {
			continue // copies collapse: the corpus counts cards, not copies
		}
		seen[oracleID] = true
		if isCommander(entry.Categories) {
			deck.Commanders = append(deck.Commanders, oracleID)
			deck.CommanderNames = append(deck.CommanderNames, entry.Card.OracleCard.Name)
			continue
		}
		deck.Cards = append(deck.Cards, oracleID)
	}

	if len(deck.Commanders) == 0 {
		return crawl.Deck{}, &crawl.ShapeError{What: "deck", Detail: fmt.Sprintf("%s: no commander found", id)}
	}
	updated, err := parseTime(resp.UpdatedAt)
	if err != nil {
		return crawl.Deck{}, &crawl.ShapeError{What: "deck", Detail: "time: " + err.Error()}
	}
	deck.UpdatedAt = updated
	sort.Strings(deck.Commanders)
	return deck, nil
}

// excludedCategories builds the set of category names that mark a card as not in the 100: the deck says so, or the
// category is one of the boards Commander excludes by definition. A card's first category decides, like the worker.
func excludedCategories(categories []struct {
	Name           string `json:"name"`
	IncludedInDeck bool   `json:"includedInDeck"`
}) map[string]bool {
	out := map[string]bool{}
	for _, c := range categories {
		if !c.IncludedInDeck || outsideDeck[strings.ToLower(c.Name)] {
			out[c.Name] = true
		}
	}
	return out
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
	return time.Time{}, fmt.Errorf("archidekt time %q not parsed", s)
}
