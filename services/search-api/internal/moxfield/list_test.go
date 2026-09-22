package moxfield

import (
	"errors"
	"strings"
	"testing"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

func TestParseListPage(t *testing.T) {
	html := `<html><body>
		<a href="/decks/aabbccdd11223344556677889900aabb">First Commander</a>
		<a href="/decks/ffeeddccbbaa99887766554433221100">Second Commander</a>
		<a href="/user/someone">profile, not a deck</a>
		<a href="/decks/nothex">bad slug, skipped</a>
	</body></html>`

	entries, err := ParseListPage([]byte(html))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}
	if entries[0].Slug != "aabbccdd11223344556677889900aabb" || entries[0].Title != "First Commander" {
		t.Fatalf("entry 0 wrong: %+v", entries[0])
	}
	if entries[1].Slug != "ffeeddccbbaa99887766554433221100" {
		t.Fatalf("entry 1 wrong: %+v", entries[1])
	}
}

func TestParseListPageWithoutDeckLinksQuarantines(t *testing.T) {
	_, err := ParseListPage([]byte("<html><body><a href='/user/me'>no decks here</a></body></html>"))
	var shape *crawl.ShapeError
	if !errors.As(err, &shape) {
		t.Fatalf("want a ShapeError, got %v", err)
	}
}

func TestParseListPageRejectsBareHTML(t *testing.T) {
	if _, err := ParseListPage([]byte("not html at all")); err == nil {
		t.Fatal("garbage HTML should error")
	}
}

func TestDeckSlugShape(t *testing.T) {
	if !deckSlugRe.MatchString("/decks/aabbccdd11223344556677889900aabb") {
		t.Fatal("32-hex deck link should match")
	}
	if deckSlugRe.MatchString("/decks/nothex") {
		t.Fatal("non-hex slug should not match")
	}
	if deckSlugRe.MatchString("/decks/" + strings.Repeat("a", 31)) {
		t.Fatal("31-char slug should not match")
	}
}
