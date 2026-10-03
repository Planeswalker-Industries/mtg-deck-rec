package crawl

import (
	"context"
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/supabase"
)

// The store against a real PostgREST, which is the only thing that can check the half of it that lives in the
// database: the function names, their argument names, the JSON each side sends and expects, and the grants.
//
// A fake HTTP server answers any path with anything, so it cannot tell a working call from `/rest/v1/corpus.decks`
// (which PostgREST reads as a table *named* "corpus.decks" in public, PGRST205) or from a filter it quietly matches
// against nothing. This is where that is caught.
//
// Local only, because it writes to a database: it skips unless both variables are set.
//
//	SUPABASE_TEST_URL=http://127.0.0.1:56321 SUPABASE_TEST_SERVICE_KEY=<local service key> \
//	  go test ./internal/crawl/ -run Live -v
func liveStore(t *testing.T) *SupabaseStore {
	t.Helper()
	url, key := os.Getenv("SUPABASE_TEST_URL"), os.Getenv("SUPABASE_TEST_SERVICE_KEY")
	if url == "" || key == "" {
		t.Skip("set SUPABASE_TEST_URL and SUPABASE_TEST_SERVICE_KEY to run the live store check")
	}
	client := supabase.New(url, key, 10*time.Second)
	return NewSupabaseStore(client, "archidekt", Defaults{})
}

// liveOracleID reads a card's oracle id from the local catalog by slug, skipping when the catalog is not loaded.
func liveOracleID(t *testing.T, store *SupabaseStore, slug string) string {
	t.Helper()
	rows, err := store.client.SelectAll(context.Background(), "cards", "oracle_id", "slug=eq."+slug)
	if err != nil {
		t.Fatalf("reading %s from the catalog: %v", slug, err)
	}
	if len(rows) == 0 {
		t.Skipf("%s is not in this catalog; run sync:catalog first", slug)
	}
	var card struct {
		OracleID string `json:"oracle_id"`
	}
	if err := json.Unmarshal(rows[0], &card); err != nil {
		t.Fatalf("reading %s: %v", slug, err)
	}
	return card.OracleID
}

func TestLiveStoreRoundTrip(t *testing.T) {
	store := liveStore(t)
	ctx := context.Background()

	if _, err := store.Policy(ctx); err != nil {
		t.Fatalf("reading the policy: %v", err)
	}
	state, err := store.CrawlState(ctx)
	if err != nil {
		t.Fatalf("reading the state: %v", err)
	}
	if state.Disabled {
		t.Skip("the source is switched off in this database; nothing to exercise")
	}

	runID, err := store.CreateRun(ctx)
	if err != nil {
		t.Fatalf("creating a run: %v", err)
	}
	claim, err := store.Claim(ctx, runID, "live-test", time.Hour)
	if err != nil {
		t.Fatalf("claiming: %v", err)
	}
	if !claim.Claimed {
		t.Fatalf("an idle source should be claimable: %+v", claim)
	}
	t.Cleanup(func() {
		if err := store.ReleaseClaim(context.Background(), runID); err != nil {
			t.Errorf("releasing: %v", err)
		}
	})

	// A second run cannot claim while the first holds it.
	otherID, err := store.CreateRun(ctx)
	if err != nil {
		t.Fatalf("creating the second run: %v", err)
	}
	second, err := store.Claim(ctx, otherID, "live-test-2", time.Hour)
	if err != nil {
		t.Fatalf("second claim: %v", err)
	}
	if second.Claimed {
		t.Fatal("two runs must not hold the same source")
	}

	// A claim older than the window is taken over, which is what stops a container that died mid-crawl from wedging
	// the source until someone clears the row by hand.
	tookOver, err := store.Claim(ctx, otherID, "live-test-2", 0)
	if err != nil {
		t.Fatalf("stale claim: %v", err)
	}
	if !tookOver.Claimed || !tookOver.TookOver {
		t.Fatalf("a stale claim should be taken over: %+v", tookOver)
	}
	t.Cleanup(func() {
		if err := store.ReleaseClaim(context.Background(), otherID); err != nil {
			t.Errorf("releasing the second: %v", err)
		}
	})

	// Decks are stored by catalog card id, so the oracle ids have to be ones the local catalog has.
	commander, card := liveOracleID(t, store, "atraxa-praetors-voice"), liveOracleID(t, store, "sol-ring")

	// A deck naming a card the catalog does not have is not stored, and says which id failed.
	stranger := DeckRow{
		SourceDeckID:    "live-test-unresolved",
		Commanders:      []string{commander},
		Cards:           map[string]int{"00000000-0000-4000-8000-00000000dead": 1},
		DeckSize:        2,
		ContentHash:     "live-test-unresolved",
		ListedUpdatedAt: time.Now().UTC().Truncate(time.Second),
		LastUpdatedAt:   time.Now().UTC().Truncate(time.Second),
	}
	unresolved, err := store.UpsertDecks(ctx, []DeckRow{stranger})
	if err != nil {
		t.Fatalf("writing an unresolvable deck: %v", err)
	}
	if len(unresolved) != 1 || unresolved[0].DeckID != stranger.SourceDeckID ||
		len(unresolved[0].Missing) != 1 || unresolved[0].Missing[0] != "00000000-0000-4000-8000-00000000dead" {
		t.Fatalf("the deck should come back unresolved, naming the card: %+v", unresolved)
	}

	deckID := "live-test-deck"
	row := DeckRow{
		SourceDeckID:    deckID,
		Commanders:      []string{commander},
		Cards:           map[string]int{card: 1},
		DeckSize:        2,
		ContentHash:     contentHash([]string{commander}, map[string]int{card: 1}),
		ListedUpdatedAt: time.Now().UTC().Truncate(time.Second),
		LastUpdatedAt:   time.Now().UTC().Truncate(time.Second),
	}
	if unresolved, err := store.UpsertDecks(ctx, []DeckRow{row}); err != nil || len(unresolved) != 0 {
		t.Fatalf("writing a deck: %+v, %v", unresolved, err)
	}

	held, err := store.DeckVersions(ctx, []string{deckID, "not-a-deck"})
	if err != nil {
		t.Fatalf("reading held decks: %v", err)
	}
	if held[deckID].Hash != row.ContentHash || !held[deckID].ListedUpdatedAt.Equal(row.ListedUpdatedAt) {
		t.Fatalf("the deck should read back with its hash and listed time: %+v", held)
	}
	if _, ok := held["not-a-deck"]; ok {
		t.Fatal("a deck we do not hold has nothing to read back")
	}

	// Same cards, a later listed time: the time is recorded, so the next visit steps over the deck.
	later := row
	later.ListedUpdatedAt = row.ListedUpdatedAt.Add(time.Hour)
	if _, err := store.UpsertDecks(ctx, []DeckRow{later}); err != nil {
		t.Fatalf("rewriting the listed time: %v", err)
	}
	if held, err = store.DeckVersions(ctx, []string{deckID}); err != nil || !held[deckID].ListedUpdatedAt.Equal(later.ListedUpdatedAt) {
		t.Fatalf("a moved listed time should be stored even when the cards are the same: %+v, %v", held, err)
	}

	// The queue: seeding is repeatable, and a commander handed to a run is not handed to it again once finished.
	if _, err := store.SeedCommanders(ctx); err != nil {
		t.Fatalf("seeding: %v", err)
	}
	next, err := store.NextCommanders(ctx, runID, 1)
	if err != nil {
		t.Fatalf("reading the queue: %v", err)
	}
	if len(next) == 1 {
		if next[0].OracleID == "" || next[0].Name == "" {
			t.Fatalf("a queued commander carries its oracle id and name: %+v", next[0])
		}
		// Partial leaves last_visited_at alone, so the local queue's order is not disturbed by the test.
		if err := store.FinishCommander(ctx, runID, next[0].CardID, CommanderResult{Outcome: OutcomePartial, Listed: 1}); err != nil {
			t.Fatalf("finishing a commander: %v", err)
		}
		again, err := store.NextCommanders(ctx, runID, 1)
		if err != nil {
			t.Fatalf("re-reading the queue: %v", err)
		}
		if len(again) == 1 && again[0].CardID == next[0].CardID {
			t.Fatal("a commander this run finished must not be handed back to it")
		}
	} else {
		t.Log("no external_commanders locally; the queue half was not exercised")
	}

	if err := store.SetCursor(ctx, deckID); err != nil {
		t.Fatalf("cursor: %v", err)
	}
	if err := store.SetProbeOK(ctx); err != nil {
		t.Fatalf("probe: %v", err)
	}
	if err := store.FinishRun(ctx, runID, RunSummary{State: "succeeded", DecksWritten: 1}); err != nil {
		t.Fatalf("finishing: %v", err)
	}

	after, err := store.CrawlState(ctx)
	if err != nil {
		t.Fatalf("re-reading the state: %v", err)
	}
	if after.LastDeckID != deckID || !after.ProbeOK {
		t.Fatalf("the state should carry the cursor and the probe: %+v", after)
	}
	if after.DeckCount < 1 {
		t.Fatalf("the deck count feeds the budget: %+v", after)
	}
}
