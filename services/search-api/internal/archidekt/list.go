package archidekt

import (
	"encoding/json"
	"net/url"
	"strconv"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// listResponse is the deck-list API (v3) shape, pinned against a live fixture in testdata/list-page.json. Only the
// fields the crawl reads are here; anything else is ignored rather than guessed at. Results is a pointer so a body
// without it (an error object) can be told apart from a commander with no decks (an empty array).
type listResponse struct {
	Count   int     `json:"count"`
	Next    *string `json:"next"`
	Results *[]struct {
		ID        int64  `json:"id"`
		Name      string `json:"name"`
		UpdatedAt string `json:"updatedAt"`
	} `json:"results"`
}

// listQuery mirrors the filters Archidekt's own deck search sends: Commander format, 100-card decks (size is the deck
// size, not the page size - Archidekt pages by 60), most viewed first. View order holds still between visits, so a
// commander's page 1 is the same decks tomorrow; the commander name and page number go on the end.
const listQuery = "deckFormat=3&size=100&orderBy=-viewCount"

func listURL(commanderName string, page int) string {
	return baseURL + listPath + "?" + listQuery +
		"&commanderName=" + url.QueryEscape(commanderName) + "&page=" + strconv.Itoa(page)
}

// ParseList reads one page of a commander's decks: ids and listed update times in list order, and whether another
// page follows. An empty list is a commander with no decks; a body that is not the deck-list shape quarantines rather
// than yielding an empty run.
func ParseList(body []byte) (crawl.ListPage, error) {
	var resp listResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return crawl.ListPage{}, &crawl.ShapeError{What: "deck list", Detail: "not JSON: " + err.Error()}
	}
	if resp.Results == nil {
		return crawl.ListPage{}, &crawl.ShapeError{What: "deck list", Detail: "no results field"}
	}
	results := *resp.Results
	entries := make([]crawl.Entry, len(results))
	for i, r := range results {
		if r.ID == 0 {
			return crawl.ListPage{}, &crawl.ShapeError{What: "deck list", Detail: "a result without an id"}
		}
		entries[i] = crawl.Entry{ID: strconv.FormatInt(r.ID, 10)}
		// A listed time that does not parse is left zero: the deck is then fetched and compared by its cards, which
		// costs a request but never skips a deck that changed.
		if t, err := time.Parse(time.RFC3339Nano, r.UpdatedAt); err == nil {
			entries[i].UpdatedAt = t
		}
	}
	return crawl.ListPage{Entries: entries, HasNext: resp.Next != nil && *resp.Next != ""}, nil
}
