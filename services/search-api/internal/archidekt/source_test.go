package archidekt

import (
	"errors"
	"fmt"
	"os"
	"strings"
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

// deckBody writes a deck-detail body with `filler` one-copy cards, so a test can say what it is about (the
// qualification rule, the categories) without spelling out a hundred entries.
func deckBody(t *testing.T, header string, entries []string, filler int) []byte {
	t.Helper()
	all := append([]string(nil), entries...)
	for i := range filler {
		all = append(all, fmt.Sprintf(
			`{"quantity":1,"categories":["Ramp"],"card":{"oracleCard":{"uid":"filler-%d","name":"Filler %d"}}}`, i, i))
	}
	return []byte(fmt.Sprintf(`{%s,"cards":[%s]}`, header, strings.Join(all, ",")))
}

const publicCommanderDeck = `"updatedAt":"2026-09-22T00:00:00Z","deckFormat":3,"private":false,"unlisted":false`

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

// The fixture is a live response trimmed to a handful of card entries, so it pins the wire shape and nothing else -
// which is why this reads the parse rather than ParseDeck, whose size rule the trimming breaks (see below).
func TestParseDeckFromLiveFixture(t *testing.T) {
	deck, meta, err := parseDeckBody(fixture(t, "deck-page.json"), "26657848")
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
	if meta.Format != commanderFormat || meta.Private || meta.Unlisted {
		t.Fatalf("the fixture is a public Commander deck: %+v", meta)
	}
}

func TestParseDeckRejectsATrimmedFixtureOnSize(t *testing.T) {
	_, err := ParseDeck(fixture(t, "deck-page.json"), "26657848")
	var unqualified *crawl.NotQualified
	if !errors.As(err, &unqualified) || unqualified.Reason != "not a 100-card deck" {
		t.Fatalf("a six-card body is not a Commander deck: %v", err)
	}
}

// The browse feed's filters are not a guarantee: it lists decks that are not Commander, not public, and not a
// hundred cards. Each of those is an ordinary skip, never a quarantine.
func TestParseDeckQualification(t *testing.T) {
	commander := `{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"uid":"cmd","name":"Com"}}}`
	for _, tc := range []struct {
		name   string
		header string
		filler int
		reason string
	}{
		{"a 100-card public Commander deck", publicCommanderDeck, 99, ""},
		{"another format", `"updatedAt":"2026-09-22T00:00:00Z","deckFormat":1`, 99, "not Commander format"},
		{"a private deck", `"updatedAt":"2026-09-22T00:00:00Z","deckFormat":3,"private":true`, 99, "not public"},
		{"an unlisted deck", `"updatedAt":"2026-09-22T00:00:00Z","deckFormat":3,"unlisted":true`, 99, "not public"},
		{"a deck mid-edit", publicCommanderDeck, 60, "not a 100-card deck"},
		{"a deck over 100", publicCommanderDeck, 120, "not a 100-card deck"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			deck, err := ParseDeck(deckBody(t, tc.header, []string{commander}, tc.filler), "x")
			if tc.reason == "" {
				if err != nil {
					t.Fatalf("should qualify: %v", err)
				}
				if deck.Size != 100 {
					t.Fatalf("size: %d", deck.Size)
				}
				return
			}
			var unqualified *crawl.NotQualified
			if !errors.As(err, &unqualified) {
				t.Fatalf("want NotQualified, got %v", err)
			}
			if unqualified.Reason != tc.reason {
				t.Fatalf("reason %q, want %q", unqualified.Reason, tc.reason)
			}
		})
	}
}

func TestParseDeckQuarantinesOnAChangedShape(t *testing.T) {
	var shape *crawl.ShapeError
	for _, body := range []string{
		`not json`,
		`{"deckFormat":3,"cards":[]}`,
		`{"deckFormat":3,"cards":[{"quantity":1,"categories":["Ramp"],"card":{"oracleCard":{"uid":"a"}}}]}`, // no updatedAt
		`{"updatedAt":"2026-09-22T00:00:00Z","deckFormat":3,"cards":[{"quantity":1,"categories":["Ramp"],"card":{}}]}`,
	} {
		if _, err := ParseDeck([]byte(body), "x"); !errors.As(err, &shape) {
			t.Fatalf("want a ShapeError for %s, got %v", body, err)
		}
	}
}

// A card nobody has categorised is in the deck. Archidekt leaves new cards uncategorised, so dropping them would
// write back a fraction of the list - and quietly, because the rest of the deck still parses.
func TestParseDeckKeepsUncategorisedCards(t *testing.T) {
	entries := []string{
		`{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"uid":"cmd","name":"Com"}}}`,
		`{"quantity":1,"categories":[],"card":{"oracleCard":{"uid":"uncategorised","name":"Uncategorised"}}}`,
		`{"quantity":1,"card":{"oracleCard":{"uid":"no-key","name":"No categories key"}}}`,
	}
	deck, err := ParseDeck(deckBody(t, publicCommanderDeck, entries, 97), "x")
	if err != nil {
		t.Fatal(err)
	}
	if deck.Cards["uncategorised"] != 1 || deck.Cards["no-key"] != 1 {
		t.Fatalf("uncategorised cards belong to the deck: %v", deck.Cards)
	}
	if deck.Size != 100 {
		t.Fatalf("size: %d", deck.Size)
	}
}

func TestParseDeckExcludesSideboardAndRemoved(t *testing.T) {
	entries := []string{
		`{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"uid":"cmd","name":"Com"}}}`,
		`{"quantity":1,"categories":["Ramp"],"card":{"oracleCard":{"uid":"in","name":"In"}}}`,
		`{"quantity":1,"categories":["Sideboard"],"card":{"oracleCard":{"uid":"out","name":"Out"}}}`,
		`{"quantity":1,"categories":["Ramp"],"deletedAt":"2026-09-22T00:00:01Z","card":{"oracleCard":{"uid":"gone","name":"Gone"}}}`,
	}
	header := publicCommanderDeck + `,"categories":[{"name":"Commander","includedInDeck":true},{"name":"Sideboard","includedInDeck":false}]`
	deck, err := ParseDeck(deckBody(t, header, entries, 98), "x")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := deck.Cards["out"]; ok {
		t.Fatalf("a sideboard card is not in the deck: %v", deck.Cards)
	}
	if _, ok := deck.Cards["gone"]; ok {
		t.Fatalf("a removed card is not in the deck: %v", deck.Cards)
	}
	if deck.Cards["in"] != 1 || deck.Size != 100 {
		t.Fatalf("cards %v size %d", deck.Cards, deck.Size)
	}
}

// A deck can file a card under a board it never declared in its category metadata.
func TestParseDeckExcludesUndeclaredBoards(t *testing.T) {
	entries := []string{
		`{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"uid":"cmd","name":"Com"}}}`,
		`{"quantity":1,"categories":["Maybeboard"],"card":{"oracleCard":{"uid":"maybe","name":"Maybe"}}}`,
	}
	deck, err := ParseDeck(deckBody(t, publicCommanderDeck, entries, 99), "x")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := deck.Cards["maybe"]; ok {
		t.Fatalf("an undeclared maybeboard is still a maybeboard: %v", deck.Cards)
	}
}

// Quantities are the point: thirty Forests are not one Forest, and the 100-card rule cannot be checked without them.
func TestParseDeckKeepsQuantities(t *testing.T) {
	entries := []string{
		`{"quantity":1,"categories":["Commander"],"card":{"oracleCard":{"uid":"cmd","name":"Com"}}}`,
		`{"quantity":30,"categories":["Land"],"card":{"oracleCard":{"uid":"mountain","name":"Mountain"}}}`,
		`{"quantity":2,"categories":["Land"],"card":{"oracleCard":{"uid":"mountain","name":"Mountain"}}}`,
	}
	deck, err := ParseDeck(deckBody(t, publicCommanderDeck, entries, 67), "x")
	if err != nil {
		t.Fatal(err)
	}
	// Two entries for the same card are the same card: the quantities add rather than one winning.
	if deck.Cards["mountain"] != 32 {
		t.Fatalf("copies should add: %v", deck.Cards)
	}
	if deck.Size != 100 {
		t.Fatalf("size: %d", deck.Size)
	}
}
