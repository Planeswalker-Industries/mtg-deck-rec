package moxfield

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// A deck page's shape is a Slice 3a concern: the exact script tag Moxfield embeds the deck JSON in was unreachable
// when this was written (Cloudflare blocked honest-UA fetches from the dev network), so the parser hunts for the
// data rather than a fixed path, and a page that yields neither cards nor a timestamp quarantines (ShapeError). When
// a live fixture pins the real embed, whatever needs to move lives in findDeckJSON / deckFromJSON, not in the run.
type Deck struct {
	Slug           string
	CommanderNames []string
	Commanders     []string // oracle ids, sorted so a partner pair keys deterministically
	Cards          []string // oracle ids of the other cards, as listed
	UpdatedAt      time.Time
}

type deckCard struct {
	OracleID    string
	Name        string
	IsCommander bool
}

// maxEmbedDepth bounds the JSON walk. Moxfield's embeds nest a few levels; anything deeper is not a deck payload.
const maxEmbedDepth = 6

// ParseDeckPage extracts the deck from a deck page's HTML. slug comes from the browse link that led here.
func ParseDeckPage(html []byte, slug string) (Deck, error) {
	raw, ok := findDeckJSON(html)
	if !ok {
		return Deck{}, &crawl.ShapeError{What: "deck", Detail: fmt.Sprintf("no JSON script tag for deck %s", slug)}
	}
	cards, updated, err := deckFromJSON(raw)
	if err != nil {
		return Deck{}, err
	}

	deck := Deck{Slug: slug, UpdatedAt: updated}
	for _, card := range cards {
		if card.IsCommander {
			deck.Commanders = append(deck.Commanders, card.OracleID)
			if card.Name != "" {
				deck.CommanderNames = append(deck.CommanderNames, card.Name)
			}
			continue
		}
		deck.Cards = append(deck.Cards, card.OracleID)
	}
	if len(deck.Commanders) == 0 {
		return Deck{}, &crawl.ShapeError{What: "deck", Detail: fmt.Sprintf("%s: no commander found", slug)}
	}
	sort.Strings(deck.Commanders)
	return deck, nil
}

// findDeckJSON returns the first script body that parses as a JSON object and mentions "cards". Moxfield (a Blazor
// site) embeds render data in script tags; goquery keeps "a <script> tag" honest instead of regexp-hunting the page.
func findDeckJSON(html []byte) (json.RawMessage, bool) {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(html))
	if err != nil {
		return nil, false
	}
	var raw json.RawMessage
	found := false
	doc.Find("script").EachWithBreak(func(_ int, s *goquery.Selection) bool {
		text := strings.TrimSpace(s.Text())
		if strings.HasPrefix(text, "{") && strings.Contains(text, "cards") && json.Valid([]byte(text)) {
			raw = json.RawMessage(text)
			found = true
			return false
		}
		return true
	})
	return raw, found
}

// deckFromJSON walks the embed for card records and an update timestamp. Cards surface as an array (or a keyed
// object) under a "cards" key; a record carries its own oracle id or holds a "card" object that does.
func deckFromJSON(raw json.RawMessage) ([]deckCard, time.Time, error) {
	var root map[string]any
	if err := json.Unmarshal(raw, &root); err != nil {
		return nil, time.Time{}, &crawl.ShapeError{What: "deck", Detail: "JSON does not parse: " + err.Error()}
	}

	var cards []deckCard
	walk(root, "", false, &cards, 0)
	ts, _ := findTime(root, 0)

	if len(cards) == 0 {
		return nil, time.Time{}, &crawl.ShapeError{What: "deck", Detail: "no card records in embed"}
	}
	return cards, ts, nil
}

// walk scans arbitrary JSON for card records. underCommanders is set when the parent key named a commander slot,
// because Moxfield's commander array omits the "categories" a main-board card carries.
func walk(node any, parentKey string, underCommanders bool, cards *[]deckCard, depth int) {
	if depth > maxEmbedDepth {
		return
	}
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			if obj, isMap := item.(map[string]any); isMap {
				if card, isCard := cardFrom(obj, underCommanders); isCard {
					*cards = append(*cards, card)
					continue
				}
			}
			walk(item, parentKey, underCommanders, cards, depth+1)
		}
	case map[string]any:
		if card, isCard := cardFrom(v, underCommanders); isCard {
			*cards = append(*cards, card)
			return
		}
		for key, val := range v {
			next := underCommanders || key == "commanders" || key == "commander"
			walk(val, key, next, cards, depth+1)
		}
	}
}

var commanderKeys = []string{"oracle_id", "oracleId", "uuid", "scryfall_id"}

func cardFrom(obj map[string]any, underCommanders bool) (deckCard, bool) {
	source := obj
	if nested, ok := obj["card"].(map[string]any); ok {
		source = nested
	}
	id, _ := firstString(source, commanderKeys...)
	if id == "" {
		return deckCard{}, false
	}
	name, _ := firstString(source, "name")
	commander := underCommanders || objCommander(obj)
	if categories, ok := obj["categories"].([]any); ok {
		commander = commander || containsCommander(categories)
	}
	return deckCard{OracleID: id, Name: name, IsCommander: commander}, true
}

// objCommander reads the boolean markers Moxfield's embeds have shipped; a category check covers the format that
// lists roles as strings instead.
func objCommander(obj map[string]any) bool {
	b, ok := obj["isCommander"].(bool)
	if !ok {
		b, ok = obj["commander"].(bool)
	}
	return ok && b
}

func containsCommander(categories []any) bool {
	for _, c := range categories {
		if s, ok := c.(string); ok && strings.Contains(strings.ToLower(s), "commander") {
			return true
		}
	}
	return false
}

func firstString(obj map[string]any, keys ...string) (string, bool) {
	for _, k := range keys {
		if s, ok := obj[k].(string); ok && s != "" {
			return s, true
		}
	}
	return "", false
}

// findTime looks for the deck's update timestamp under the key names Moxfield uses, at any nesting depth.
func findTime(node any, depth int) (time.Time, bool) {
	if depth > maxEmbedDepth {
		return time.Time{}, false
	}
	switch v := node.(type) {
	case []any:
		for _, item := range v {
			if t, ok := findTime(item, depth+1); ok {
				return t, true
			}
		}
	case map[string]any:
		for key, val := range v {
			if key == "updatedAt" || key == "lastUpdated" {
				if s, ok := val.(string); ok {
					if t, err := parseMoxTime(s); err == nil {
						return t, true
					}
				}
			}
			if t, ok := findTime(val, depth+1); ok {
				return t, true
			}
		}
	}
	return time.Time{}, false
}

func parseMoxTime(s string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("moxfield time %q not parsed", s)
}
