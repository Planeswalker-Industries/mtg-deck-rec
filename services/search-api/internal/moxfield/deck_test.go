package moxfield

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// The embed shapes below are the assumed Moxfield deck JSON; the real shape is pinned by the Slice 3a fixture. These
// tests prove the parser finds cards and timestamps wherever within reason, and quarantines when it finds nothing.

func TestParseDeckPage(t *testing.T) {
	slug := "aabbccdd11223344556677889900aabb"
	html := fmt.Sprintf(`<html><head>
		<script type="application/json">{"deck":{
			"updatedAt": "2026-09-20T12:34:56Z",
			"cards": [
				{"card":{"oracle_id":"aaaa0000","name":"Atraxa, Praetors' Voice"},"quantity":1,"categories":["commanders"]},
				{"card":{"oracle_id":"bbbb0000","name":"Sol Ring"},"quantity":1,"categories":[]},
				{"oracle_id":"cccc0000","name":"Arcane Signet","quantity":1}
			]
		}}</script>
	</head></html>`)

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
	if len(deck.Cards) != 2 || deck.Cards[0] != "bbbb0000" || deck.Cards[1] != "cccc0000" {
		t.Fatalf("cards: %v", deck.Cards)
	}
	if want := time.Date(2026, 9, 20, 12, 34, 56, 0, time.UTC); !deck.UpdatedAt.Equal(want) {
		t.Fatalf("updated: %v, want %v", deck.UpdatedAt, want)
	}
}

func TestParseDeckPageCommandersInOwnArray(t *testing.T) {
	html := `<script>{"name":"Rog",
		"lastUpdated": "2026-09-19T08:00:00Z",
		"commanders": [{"oracle_id":"rog00","name":"Rograkh, Son of Rohgahh"}],
		"cards": [{"oracle_id":"kor00","name":"Kor, First in Line"}]}</script>`
	deck, err := ParseDeckPage([]byte(html), "rogkor")
	if err != nil {
		t.Fatal(err)
	}
	if len(deck.Commanders) != 1 || deck.Commanders[0] != "rog00" {
		t.Fatalf("commanders under a commanders key: %v", deck.Commanders)
	}
	if len(deck.Cards) != 1 || deck.Cards[0] != "kor00" {
		t.Fatalf("cards: %v", deck.Cards)
	}
}

func TestParseDeckPageMissingCommandersQuarantines(t *testing.T) {
	html := `<script>{"cards":[{"oracle_id":"x"}]}</script>`
	_, err := ParseDeckPage([]byte(html), "nodeck")
	var shape *crawl.ShapeError
	if !errors.As(err, &shape) {
		t.Fatalf("want a ShapeError, got %v", err)
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
