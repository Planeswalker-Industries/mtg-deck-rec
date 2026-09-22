package archidekt

import (
	"errors"
	"os"
	"testing"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	body, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestParseListFromLiveFixture(t *testing.T) {
	entries, err := ParseList(fixture(t, "list-page.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 6 {
		t.Fatalf("got %d entries, want 6", len(entries))
	}
	// The fixture's first deck is the one the crawl would hit first.
	if entries[0].ID != "26657848" {
		t.Fatalf("first id: %s", entries[0].ID)
	}
	if entries[1].ID == "" {
		t.Fatal("ids should not be empty")
	}
}

func TestParseListRejectsABodyThatIsNotDeckList(t *testing.T) {
	_, err := ParseList([]byte("not json at all"))
	var shape *crawl.ShapeError
	if !errors.As(err, &shape) {
		t.Fatalf("want a ShapeError, got %v", err)
	}
	_, err = ParseList([]byte(`{"error":"no collection found"}`))
	if !errors.As(err, &shape) {
		t.Fatalf("a JSON body without results should quarantine, got %v", err)
	}
}

func TestParseDeckFromLiveFixture(t *testing.T) {
	deck, err := ParseDeck(fixture(t, "deck-page.json"), "26657848")
	if err != nil {
		t.Fatal(err)
	}
	if len(deck.Commanders) != 1 || deck.Commanders[0] != "02598a35-1b11-4abe-89cd-fc44c8c36c15" {
		t.Fatalf("commanders: %v", deck.Commanders)
	}
	if len(deck.CommanderNames) != 1 || deck.CommanderNames[0] != "Winota, Joiner of Forces" {
		t.Fatalf("commander names: %v", deck.CommanderNames)
	}
	if deck.UpdatedAt.IsZero() {
		t.Fatal("no update time")
	}
	if len(deck.Cards) == 0 {
		t.Fatal("the fixture has in-deck cards")
	}
}

func TestParseDeckMissingCommanderQuarantines(t *testing.T) {
	body := []byte(`{"updatedAt":"2026-09-22T00:00:00Z","cards":[
		{"quantity":1,"categories":["Ramp"],"card":{"oracleCard":{"uid":"abc","name":"Sol Ring"}}}
	]}`)
	_, err := ParseDeck(body, "x")
	var shape *crawl.ShapeError
	if !errors.As(err, &shape) {
		t.Fatalf("want a ShapeError, got %v", err)
	}
}

func TestParseDeckExcludesSideboardAndRemoved(t *testing.T) {
	body := []byte(`{
		"updatedAt":"2026-09-22T00:00:00Z",
		"categories":[{"name":"Commander","includedInDeck":true},{"name":"Sideboard","includedInDeck":false}],
		"cards":[
			{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"uid":"cmd","name":"Com"}}},
			{"quantity":1,"categories":["Ramp"],"card":{"oracleCard":{"uid":"in","name":"In"}}},
			{"quantity":1,"categories":["Sideboard"],"card":{"oracleCard":{"uid":"out","name":"Out"}}},
			{"quantity":1,"categories":["Ramp"],"deletedAt":"2026-09-22T00:00:01Z","card":{"oracleCard":{"uid":"gone","name":"Gone"}}}
		]
	}`)
	deck, err := ParseDeck(body, "x")
	if err != nil {
		t.Fatal(err)
	}
	if len(deck.Cards) != 1 || deck.Cards[0] != "in" {
		t.Fatalf("sideboard and removed cards must be excluded: %v", deck.Cards)
	}
}

func TestParseDeckCollapsesCopies(t *testing.T) {
	body := []byte(`{
		"updatedAt":"2026-09-22T00:00:00Z",
		"cards":[
			{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"uid":"cmd","name":"Com"}}},
			{"quantity":2,"categories":["Land"],"card":{"oracleCard":{"uid":"mountain","name":"Mountain"}}},
			{"quantity":1,"categories":["Land"],"card":{"oracleCard":{"uid":"mountain","name":"Mountain"}}}
		]
	}`)
	deck, err := ParseDeck(body, "x")
	if err != nil {
		t.Fatal(err)
	}
	if len(deck.Cards) != 1 {
		t.Fatalf("copies should collapse to one oracle id: %v", deck.Cards)
	}
}
