package crawl

import (
	"context"
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

	deckID := "live-test-deck"
	row := DeckRow{
		SourceDeckID:    deckID,
		Commanders:      []string{"com-a", "com-b"},
		Cards:           map[string]int{"card-x": 1, "forest": 30},
		DeckSize:        100,
		ContentHash:     contentHash([]string{"com-a", "com-b"}, map[string]int{"card-x": 1, "forest": 30}),
		ListedUpdatedAt: time.Now().UTC().Truncate(time.Second),
		LastUpdatedAt:   time.Now().UTC().Truncate(time.Second),
	}
	if err := store.UpsertDecks(ctx, []DeckRow{row}); err != nil {
		t.Fatalf("writing a deck: %v", err)
	}

	hashes, err := store.DeckHashes(ctx, []string{deckID, "not-a-deck"})
	if err != nil {
		t.Fatalf("reading hashes: %v", err)
	}
	if hashes[deckID] != row.ContentHash {
		t.Fatalf("the deck should read back by its hash: %v", hashes)
	}
	if _, ok := hashes["not-a-deck"]; ok {
		t.Fatal("a deck we do not hold has no hash")
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
