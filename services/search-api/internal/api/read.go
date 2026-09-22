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
	// One per query_by field. name_head exists to rank "starts with" above "contains", so matching inside its words
	// would defeat it; name and names match mid-word, which is what finds *General Thunderbolt Ross* from "bolt".
	// `always` rather than `fallback`: fallback only searches infix when nothing else matched at all, and "bolt"
	// already matches *Guiding Bolt*, so the card people were looking for would still be missing.
	searchInfix  = "off,always,always"
	searchSortBy = "_text_match:desc,commander_deck_count:desc,staple_score:desc"

	// The deckbuilder ranks differently, because it is a different question. A picker asks "which card did you mean",
	// so it breaks ties on how often a card leads a deck. The deckbuilder asks "what should go in this deck", so it
	// breaks ties on how often Commander decks play the card at all, and then on the name so that paging is stable.
	builderSortBy = "_text_match:desc,baseline_rate:desc,name:asc"
	// A browse has no query to score, so play rate is the whole ranking. Same order as the Postgres fallback.
	browseSortBy = "baseline_rate:desc,name:asc"

	// Commander legality is not a filter the caller chooses: the deckbuilder builds Commander decks, and the Postgres
	// function it replaces has the same condition baked in. Basic lands stay, because decks run them.
	builderLegalFilter = "legal_commander:=legal"
)

// The mana curve's last bar means "this much or more", matching the deckbuilder's 7+ pill and p_mana_value_top in
// search_cards_filtered.
const manaValueTop = 7

var colorLetters = [...]string{"W", "U", "B", "R", "G"}

// identityFilter is the Typesense spelling of Postgres's `(color_identity & ~mask) = 0`: a card may not carry a colour
// the deck's identity lacks. Typesense has no bitwise operators, so the filter names the colours that are *not*
// allowed. Colourless fits every deck, so an empty `colors` array always passes, and a five-colour deck excludes
// nothing and needs no filter at all. Mirrors identityFilter() in @mtg/core/search.
func identityFilter(colors string) string {
	allowed := map[string]bool{}
	for _, letter := range strings.Split(strings.ToUpper(colors), "") {
		allowed[letter] = true
	}
	var disallowed []string
	for _, letter := range colorLetters {
		if !allowed[letter] {
			disallowed = append(disallowed, letter)
		}
	}
	if len(disallowed) == 0 {
		return ""
	}
	return "colors:!=[" + strings.Join(disallowed, ",") + "]"
}

// Ceilings on what one request may ask for. A deck is 100 cards, an add pool 400, a commander page 500; anything
// far past that is a mistake or an abuser, and either way it should not become a 40-way multi_search.
const (
	maxIDsPerRequest  = 2000
	maxKeysPerRequest = 32
	maxSearchLimit    = 50
	// The deckbuilder's "More cards" walks forward a page at a time. Far past this nobody is reading results, and
	// deep paging is where an engine starts doing real work per request.
	maxSearchOffset = 1000
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

// cardsSearch serves both card searches the app makes.
//
//   - A plain name search (the header picker): two letters or more, ranked by how well the name matches.
//   - The deckbuilder's search: the same name match narrowed to the commander's colours, a card type and a mana
//     value, and — with no name at all — a browse of those filtered cards by how widely Commander decks play them.
//
// The second used to be a Postgres function because the index had no card-type field. It has one now
// (`card_category`), so both run here, and `search_cards_filtered` stays as the fallback every read path keeps.
func (s *Server) cardsSearch(c fiber.Ctx) error {
	q := strings.TrimSpace(c.Query("q"))
	limit, err := strconv.Atoi(c.Query("limit", "8"))
	if err != nil || limit < 1 || limit > maxSearchLimit {
		return badRequest(fmt.Sprintf("limit must be a number between 1 and %d", maxSearchLimit))
	}
	offset, err := strconv.Atoi(c.Query("offset", "0"))
	if err != nil || offset < 0 || offset > maxSearchOffset {
		return badRequest(fmt.Sprintf("offset must be a number between 0 and %d", maxSearchOffset))
	}

	filters, err := builderFilters(c)
	if err != nil {
		return err
	}
	// Without a name there has to be something to narrow by, or this is a request for the whole catalog by play rate.
	// The app never asks for that; refusing it here keeps a bug or an abuser from making the engine prove it.
	if len(q) < 2 && len(filters) == 0 {
		// The app normalises and length-checks before calling, so this is a guard, not a behaviour.
		return c.JSON(fiber.Map{"cards": []json.RawMessage{}})
	}
	if c.Query("commanderOnly") == "1" {
		filters = dedupe(append(filters, "can_be_commander:=true", builderLegalFilter))
	}

	prefix := true
	params := typesense.SearchParams{
		Collection: cardsCollection,
		FilterBy:   strings.Join(filters, " && "),
		Limit:      limit,
		Offset:     offset,
	}
	switch {
	case len(q) < 2:
		// `*` is Typesense's "every document"; there is no text to score, so play rate is the whole ranking.
		params.Q = "*"
		params.SortBy = browseSortBy
	default:
		params.Q = q
		params.QueryBy = searchQueryBy
		params.QueryByWeights = searchQueryByWeights
		params.Prefix = &prefix
		params.Infix = searchInfix
		params.SortBy = searchSortBy
		if c.Query("builder") == "1" {
			params.SortBy = builderSortBy
		}
	}

	result, err := s.ts.Search(c.Context(), params)
	if err != nil {
		return err
	}
	return c.JSON(fiber.Map{"cards": documents([]typesense.SearchResult{result})})
}

// builderFilters reads the deckbuilder's narrowing parameters. Each is optional and each is validated, because these
// arrive from a URL: an unparseable one is a bad request rather than a filter quietly dropped, which would answer a
// question nobody asked with results that look right.
func builderFilters(c fiber.Ctx) ([]string, error) {
	var filters []string
	if colors := c.Query("colors"); colors != "" || c.Query("colorless") == "1" {
		filters = append(filters, builderLegalFilter)
		if f := identityFilter(colors); f != "" {
			filters = append(filters, f)
		}
	}
	if category := c.Query("type"); category != "" {
		if !categoryShape.MatchString(category) {
			return nil, badRequest("type must be a card category")
		}
		filters = append(filters, "card_category:="+category, builderLegalFilter)
	}
	if raw := c.Query("mv"); raw != "" {
		mv, err := strconv.Atoi(raw)
		if err != nil || mv < 0 || mv > manaValueTop {
			return nil, badRequest(fmt.Sprintf("mv must be a number between 0 and %d", manaValueTop))
		}
		if mv >= manaValueTop {
			filters = append(filters, fmt.Sprintf("mana_value:>=%d", manaValueTop))
		} else {
			// mana_value is a float because a few cards have one; the deckbuilder's pills are whole numbers, so a
			// card sits in the bar its value floors into.
			filters = append(filters, fmt.Sprintf("mana_value:>=%d && mana_value:<%d", mv, mv+1))
		}
		filters = append(filters, builderLegalFilter)
	}
	return dedupe(filters), nil
}

// dedupe keeps the filter string short when several parameters each demand Commander legality.
func dedupe(in []string) []string {
	seen := map[string]bool{}
	out := in[:0]
	for _, s := range in {
		if !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
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
