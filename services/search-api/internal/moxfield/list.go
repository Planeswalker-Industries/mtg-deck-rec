package moxfield

import (
	"bytes"
	"regexp"
	"strings"

	"github.com/PuerkitoBio/goquery"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// deckSlugRe matches the crawlable deck links on the browse page. A Moxfield deck id is 32 hex characters; anything
// else on the page (user profiles, articles) is not a deck and is skipped.
var deckSlugRe = regexp.MustCompile(`^/decks/([0-9a-f]{32})$`)

// ListEntry is one deck the browse page offered, in feed order (the crawl relies on that order being roughly
// newest-update-first).
type ListEntry struct {
	Slug  string
	Title string
}

// ParseListPage pulls deck links out of the browse-all page. The timestamp the list shows beside each deck is
// deliberately ignored here: the deck page reports its own authoritative update time, and the crawl decides
// "already current" against that, so this parser never has to guess a date format.
func ParseListPage(html []byte) ([]ListEntry, error) {
	doc, err := goquery.NewDocumentFromReader(bytes.NewReader(html))
	if err != nil {
		return nil, &crawl.ShapeError{What: "deck list", Detail: "unreadable HTML: " + err.Error()}
	}

	var entries []ListEntry
	doc.Find(`a[href^="/decks/"]`).Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if !ok {
			return
		}
		m := deckSlugRe.FindStringSubmatch(href)
		if m == nil {
			return
		}
		entries = append(entries, ListEntry{Slug: m[1], Title: strings.TrimSpace(s.Text())})
	})
	if len(entries) == 0 {
		return nil, &crawl.ShapeError{What: "deck list", Detail: "no /decks/<32-hex> links found"}
	}
	return entries, nil
}
