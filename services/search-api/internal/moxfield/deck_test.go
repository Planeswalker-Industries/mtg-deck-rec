package moxfield

import (
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// The embed shapes below are the assumed Moxfield deck JSON; the real shape is pinned by the Slice 3a fixture. These
// tests prove the parser finds cards and timestamps wherever within reason, and quarantines when it finds nothing.
//
// Because the shape is assumed, ParseDeckPage also refuses anything that is not exactly a hundred cards: a
// heuristic that reads half a deck produces a list that looks plausible and is wrong. `filler` pads these bodies to
// a whole deck so each test is about the thing it names.

// filler writes n one-copy card records, so a test body can be a hundred cards without saying so a hundred times.
func filler(n int) string {
	records := make([]string, n)
	for i := range n {
		records[i] = fmt.Sprintf(`{"oracle_id":"filler%04d","name":"Filler %d","quantity":1}`, i, i)
	}
	return strings.Join(records, ",")
}

func TestParseDeckPage(t *testing.T) {
	slug := "aabbccdd11223344556677889900aabb"
	html := fmt.Sprintf(`<html><head>
		<script type="application/json">{"deck":{
			"updatedAt": "2026-09-20T12:34:56Z",
			"cards": [
				{"card":{"oracle_id":"aaaa0000","name":"Atraxa, Praetors' Voice"},"quantity":1,"categories":["commanders"]},
				{"card":{"oracle_id":"bbbb0000","name":"Sol Ring"},"quantity":1,"categories":[]},
				{"oracle_id":"cccc0000","name":"Arcane Signet","quantity":1},
				%s
			]
		}}</script>
	</head></html>`, filler(97))

	deck, err := ParseDeckPage([]byte(html), slug)
	if err != nil {
		t.Fatal(err)
	}
	if deck.Slug != slug {
		t.Fatalf("slug: %q", deck.Slug)
	}
	if len(deck.Commanders) != 1 || deck.Commanders[0] != "aaaa0000" {
		t.Fatalf("commanders: %v", deck.Commanders)
	}
	if len(deck.CommanderNames) != 1 || deck.CommanderNames[0] != "Atraxa, Praetors' Voice" {
		t.Fatalf("commander names: %v", deck.CommanderNames)
	}
	if deck.Cards["bbbb0000"] != 1 || deck.Cards["cccc0000"] != 1 {
		t.Fatalf("cards: %v", deck.Cards)
	}
	if deck.Size != 100 {
		t.Fatalf("size: %d", deck.Size)
	}
	if want := time.Date(2026, 9, 20, 12, 34, 56, 0, time.UTC); !deck.UpdatedAt.Equal(want) {
		t.Fatalf("updated: %v, want %v", deck.UpdatedAt, want)
	}
}

func TestParseDeckPageCommandersInOwnArray(t *testing.T) {
	html := fmt.Sprintf(`<script>{"name":"Rog",
		"lastUpdated": "2026-09-19T08:00:00Z",
		"commanders": [{"oracle_id":"rog00","name":"Rograkh, Son of Rohgahh"},{"oracle_id":"kor00","name":"Kor, First in Line"}],
		"cards": [%s]}</script>`, filler(98))
	deck, err := ParseDeckPage([]byte(html), "rogkor")
	if err != nil {
		t.Fatal(err)
	}
	if len(deck.Commanders) != 2 || deck.Commanders[0] != "kor00" || deck.Commanders[1] != "rog00" {
		t.Fatalf("a partner pair under a commanders key, sorted: %v", deck.Commanders)
	}
	if len(deck.Cards) != 98 || deck.Size != 100 {
		t.Fatalf("cards %d size %d", len(deck.Cards), deck.Size)
	}
}

// A deck with no commander, or one the parser could only half read, is not written at all.
func TestParseDeckPageRefusesAnIncompleteRead(t *testing.T) {
	html := fmt.Sprintf(`<script>{"updatedAt":"2026-09-20T12:34:56Z","cards":[
		{"oracle_id":"cmd0","name":"Com","quantity":1,"categories":["commanders"]},%s]}</script>`, filler(40))
	_, err := ParseDeckPage([]byte(html), "short")
	var unqualified *crawl.NotQualified
	if !errors.As(err, &unqualified) || unqualified.Reason != "not a 100-card deck" {
		t.Fatalf("a 41-card read is not a deck: %v", err)
	}
}

// Quantities carry: a mana base is mostly repeated basics, and the size rule cannot be checked without them.
func TestParseDeckPageKeepsQuantities(t *testing.T) {
	html := fmt.Sprintf(`<script>{"updatedAt":"2026-09-20T12:34:56Z","cards":[
		{"oracle_id":"cmd0","name":"Com","quantity":1,"categories":["commanders"]},
		{"oracle_id":"forest","name":"Forest","quantity":30},%s]}</script>`, filler(69))
	deck, err := ParseDeckPage([]byte(html), "lands")
	if err != nil {
		t.Fatal(err)
	}
	if deck.Cards["forest"] != 30 || deck.Size != 100 {
		t.Fatalf("cards %v size %d", deck.Cards["forest"], deck.Size)
	}
}

func TestParseDeckPageMissingCommandersIsNotADeck(t *testing.T) {
	html := `<script>{"cards":[{"oracle_id":"x"}]}</script>`
	_, err := ParseDeckPage([]byte(html), "nodeck")
	var unqualified *crawl.NotQualified
	if !errors.As(err, &unqualified) {
		t.Fatalf("want NotQualified, got %v", err)
	}
}

func TestParseDeckPageNoEmbedQuarantines(t *testing.T) {
	_, err := ParseDeckPage([]byte("<html><body>loading...</body></html>"), "nope")
	var shape *crawl.ShapeError
	if !errors.As(err, &shape) {
		t.Fatalf("want a ShapeError, got %v", err)
	}
}

func TestParseDeckPageIgnoresScriptWithoutJSON(t *testing.T) {
	html := `<script src="/bundles/app.js"></script>` // not an embed
	_, err := ParseDeckPage([]byte(html), "nope")
	var shape *crawl.ShapeError
	if !errors.As(err, &shape) {
		t.Fatalf("want a ShapeError, got %v", err)
	}
}
