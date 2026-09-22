package archidekt

import (
	"encoding/json"
	"strconv"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// listResponse is the deck-list API (v3) shape, pinned against a live fixture in testdata/list-page.json. Only the
// fields the crawl reads are here; anything else is ignored rather than guessed at.
type listResponse struct {
	Count   int    `json:"count"`
	Next    string `json:"next"`
	Results []struct {
		ID   int64  `json:"id"`
		Name string `json:"name"`
	} `json:"results"`
}

// listURLQuery mirrors the filters Archidekt's own deck browser sends: Commander format, exactly 100 cards, newest
// update first.
const listURLQuery = "deckFormat=3&size=100&orderBy=-updatedAt&page="

// ParseList reads the feed: deck ids in the order the feed listed them. A body that is not the deck-list shape
// quarantines rather than yielding an empty run.
func ParseList(body []byte) ([]crawl.Entry, error) {
	var resp listResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, &crawl.ShapeError{What: "deck list", Detail: "not JSON: " + err.Error()}
	}
	if len(resp.Results) == 0 {
		return nil, &crawl.ShapeError{What: "deck list", Detail: "no results"}
	}
	entries := make([]crawl.Entry, len(resp.Results))
	for i, r := range resp.Results {
		entries[i] = crawl.Entry{ID: strconv.FormatInt(r.ID, 10)}
	}
	return entries, nil
}
