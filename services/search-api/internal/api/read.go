package api

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/typesense"
)

// How the card search ranks, moved here from the app because this is now where searching happens.
//
// Three fields in descending weight, each a tier of what public.search_cards does in SQL:
//
//   - name_head — the first word of every name the card goes by. This is the "starts with" tier. Typesense scores by
//     token and not by position, so without it "smothering" gave *Rug of Smothering* and *Smothering Abomination* an
//     identical _text_match and the tie fell to indexing order. Measured, not assumed.
//   - name — the "contains" tier, above names so a card whose own name matches beats one matched through a back face
//     or a flavor name.
//   - names — every alias, which is what makes accents, Alchemy names and back faces findable at all.
//
// Typos are the engine's own doing. The play-rate tie-break after the text match is the last tier: among cards that
// match equally well, the one people actually build decks around comes first.
const (
	searchQueryBy        = "name_head,name,names"
	searchQueryByWeights = "5,3,1"
	searchSortBy         = "_text_match:desc,commander_deck_count:desc,staple_score:desc"
)

// Ceilings on what one request may ask for. A deck is 100 cards, an add pool 400, a commander page 500; anything
// far past that is a mistake or an abuser, and either way it should not become a 40-way multi_search.
const (
	maxIDsPerRequest  = 2000
	maxKeysPerRequest = 32
	maxSearchLimit    = 50
)

func decodeBody(c fiber.Ctx, out any) error {
	if err := json.Unmarshal(c.Body(), out); err != nil {
		return badRequest("the request body is not valid JSON")
	}
	return nil
}

// chunk splits ids into pages Typesense will accept, so callers never have to know about that ceiling.
func chunk(ids []int, size int) [][]int {
	var out [][]int
	for i := 0; i < len(ids); i += size {
		end := min(i+size, len(ids))
		out = append(out, ids[i:end])
	}
	return out
}

func joinInts(ids []int) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.Itoa(id)
	}
	return strings.Join(parts, ",")
}

// documents pulls the raw documents out of a set of search results, in order.
func documents(results []typesense.SearchResult) []json.RawMessage {
	out := make([]json.RawMessage, 0, len(results))
	for _, result := range results {
		for _, hit := range result.Hits {
			out = append(out, hit.Document)
		}
	}
	return out
}

// cardsByID is the hottest endpoint: a swap pool is 220 cards, an add pool 400, a commander page 500. In Postgres
// each of those is a heap visit in a 92 MB table; here it is one request whose chunking happens on this side.
func (s *Server) cardsByID(c fiber.Ctx) error {
	var body struct {
		IDs []int `json:"ids"`
	}
	if err := decodeBody(c, &body); err != nil {
		return err
	}
	if len(body.IDs) == 0 {
		return c.JSON(fiber.Map{"cards": []json.RawMessage{}})
	}
	if len(body.IDs) > maxIDsPerRequest {
		return badRequest(fmt.Sprintf("at most %d ids per request", maxIDsPerRequest))
	}

	searches := make([]typesense.SearchParams, 0)
	for _, page := range chunk(body.IDs, typesense.MaxPerPage) {
		searches = append(searches, typesense.SearchParams{
			Collection: cardsCollection,
			Q:          "*",
			FilterBy:   "card_id:[" + joinInts(page) + "]",
			PerPage:    typesense.MaxPerPage,
		})
	}
	results, err := s.ts.MultiSearch(c.Context(), searches)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"cards": documents(results)})
}

func (s *Server) cardsSearch(c fiber.Ctx) error {
	q := strings.TrimSpace(c.Query("q"))
	if len(q) < 2 {
		// The app normalises and length-checks before calling, so this is a guard, not a behaviour.
		return c.JSON(fiber.Map{"cards": []json.RawMessage{}})
	}
	limit, err := strconv.Atoi(c.Query("limit", "8"))
	if err != nil || limit < 1 || limit > maxSearchLimit {
		return badRequest(fmt.Sprintf("limit must be a number between 1 and %d", maxSearchLimit))
	}

	prefix := true
	params := typesense.SearchParams{
		Collection:     cardsCollection,
		Q:              q,
		QueryBy:        searchQueryBy,
		QueryByWeights: searchQueryByWeights,
		SortBy:         searchSortBy,
		PerPage:        limit,
		Prefix:         &prefix,
	}
	if c.Query("commanderOnly") == "1" {
		params.FilterBy = "can_be_commander:=true && legal_commander:=legal"
	}

	result, err := s.ts.Search(c.Context(), params)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"cards": documents([]typesense.SearchResult{result})})
}

// pageExists answers the one question the app's proxy asks on every card and commander page view: is this slug a
// real page. A hit is conclusive; the caller treats a miss as inconclusive and asks Postgres, because this index can
// be a drain behind a card the catalog just added.
func (s *Server) pageExists(c fiber.Ctx) error {
	var collection string
	switch c.Params("kind") {
	case "card":
		collection = cardsCollection
	case "commander":
		collection = commandersCollection
	default:
		return badRequest(`kind must be "card" or "commander"`)
	}

	slug := c.Params("slug")
	if !slugShape.MatchString(slug) {
		// Not an error: nothing shaped like this is a page, and saying so costs no query.
		return c.JSON(fiber.Map{"exists": false})
	}

	result, err := s.ts.Search(c.Context(), typesense.SearchParams{
		Collection:    collection,
		Q:             "*",
		FilterBy:      "slug:=" + slug,
		PerPage:       1,
		IncludeFields: "slug",
	})
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"exists": result.Found > 0})
}

// allTags returns every Tagger tag. It is ~4,500 small documents, the app keeps them in memory, and this is where
// the paging happens so the app does not make nineteen round trips to do it.
func (s *Server) allTags(c fiber.Ctx) error {
	all := make([]json.RawMessage, 0, 4608)
	for page := 1; ; page++ {
		result, err := s.ts.Search(c.Context(), typesense.SearchParams{
			Collection: tagsCollection,
			Q:          "*",
			PerPage:    typesense.MaxPerPage,
			Page:       page,
		})
		if err != nil {
			return err
		}
		for _, hit := range result.Hits {
			all = append(all, hit.Document)
		}
		if len(result.Hits) < typesense.MaxPerPage || len(all) >= result.Found {
			break
		}
	}
	return c.JSON(fiber.Map{"tags": all})
}

// commanderCardRates is the play-rate half of loadCardCorpus: for these commander keys and these cards, what the
// corpus says. One request in place of a key-by-chunk fan-out on the caller's side.
func (s *Server) commanderCardRates(c fiber.Ctx) error {
	var body struct {
		KeyIDs  []int `json:"keyIds"`
		CardIDs []int `json:"cardIds"`
	}
	if err := decodeBody(c, &body); err != nil {
		return err
	}
	if len(body.KeyIDs) == 0 || len(body.CardIDs) == 0 {
		return c.JSON(fiber.Map{"rates": []json.RawMessage{}})
	}
	if len(body.CardIDs) > maxIDsPerRequest {
		return badRequest(fmt.Sprintf("at most %d card ids per request", maxIDsPerRequest))
	}
	if len(body.KeyIDs) > maxKeysPerRequest {
		return badRequest(fmt.Sprintf("at most %d commander keys per request", maxKeysPerRequest))
	}

	searches := make([]typesense.SearchParams, 0)
	for _, page := range chunk(body.CardIDs, typesense.MaxPerPage) {
		for _, keyID := range body.KeyIDs {
			searches = append(searches, typesense.SearchParams{
				Collection: commanderCardsCollection,
				Q:          "*",
				FilterBy:   fmt.Sprintf("key_id:=%d && card_id:[%s]", keyID, joinInts(page)),
				PerPage:    typesense.MaxPerPage,
			})
		}
	}
	results, err := s.ts.MultiSearch(c.Context(), searches)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"rates": documents(results)})
}

// commanderCardsTop is what a commander page ranks: the cards its decks play most, by shrunk inclusion. Only the ids
// come back — the caller fetches the cards themselves through cardsByID and scores them with its own weights.
func (s *Server) commanderCardsTop(c fiber.Ctx) error {
	keyIDs, err := parseIDList(c.Query("keyIds"))
	if err != nil {
		return err
	}
	if len(keyIDs) == 0 {
		return c.JSON(fiber.Map{"cardIds": []int{}})
	}
	if len(keyIDs) > maxKeysPerRequest {
		return badRequest(fmt.Sprintf("at most %d commander keys per request", maxKeysPerRequest))
	}
	limit, err := strconv.Atoi(c.Query("limit", "500"))
	if err != nil || limit < 1 || limit > maxIDsPerRequest {
		return badRequest(fmt.Sprintf("limit must be a number between 1 and %d", maxIDsPerRequest))
	}

	searches := make([]typesense.SearchParams, 0)
	for page := 1; (page-1)*typesense.MaxPerPage < limit; page++ {
		searches = append(searches, typesense.SearchParams{
			Collection:    commanderCardsCollection,
			Q:             "*",
			FilterBy:      "key_id:[" + joinInts(keyIDs) + "]",
			SortBy:        "inclusion_shrunk:desc",
			IncludeFields: "card_id",
			PerPage:       min(typesense.MaxPerPage, limit-(page-1)*typesense.MaxPerPage),
			Page:          page,
		})
	}
	results, err := s.ts.MultiSearch(c.Context(), searches)
	if err != nil {
		return err
	}

	// Ordered, and de-duplicated across keys: two commander keys can both play a card, and the caller wants a
	// ranked list of cards rather than of rows.
	seen := make(map[int]struct{}, limit)
	cardIDs := make([]int, 0, limit)
	for _, doc := range documents(results) {
		var parsed struct {
			CardID int `json:"card_id"`
		}
		if err := json.Unmarshal(doc, &parsed); err != nil {
			return fmt.Errorf("commander_cards document without a card_id: %w", err)
		}
		if _, ok := seen[parsed.CardID]; ok {
			continue
		}
		seen[parsed.CardID] = struct{}{}
		cardIDs = append(cardIDs, parsed.CardID)
	}
	return c.JSON(fiber.Map{"cardIds": cardIDs})
}

func parseIDList(raw string) ([]int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	parts := strings.Split(raw, ",")
	ids := make([]int, 0, len(parts))
	for _, part := range parts {
		id, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil {
			return nil, badRequest("ids must be a comma-separated list of numbers")
		}
		ids = append(ids, id)
	}
	return ids, nil
}
