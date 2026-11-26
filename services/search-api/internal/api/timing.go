package api

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/typesense"
)

// Where a read's time goes, per request: in Typesense, in this service, and how much it sends. requestLog writes it
// into the request line and the read handlers send it as a Server-Timing header, so a slow read can be placed on a
// hop from either end without another investigation (the one on 2026-11-26 needed SSH and a load script for this).
type timing struct {
	// Wall time of the Typesense calls, as this service waited for them. Parallel chunks overlap, so this is less
	// than the sum of their search times.
	typesense time.Duration
	// Typesense's own search_time_ms, summed over the chunks: what the engine says it spent.
	searchMS int
	chunks   int
	// JSON encoding of the answer, and its size before compression.
	encode time.Duration
	bytes  int
	// Everything inside the compress middleware: the handler, encoding included. The request's total minus this is
	// the compression.
	handler time.Duration
}

const timingKey = "timing"

func timingOf(c fiber.Ctx) *timing {
	if t, ok := c.Locals(timingKey).(*timing); ok {
		return t
	}
	t := &timing{}
	c.Locals(timingKey, t)
	return t
}

// handlerTimer sits inside the compress middleware, so the time it measures excludes compression.
func handlerTimer(c fiber.Ctx) error {
	start := time.Now()
	err := c.Next()
	timingOf(c).handler = time.Since(start)
	return err
}

// searchAll is SearchAll with the time recorded.
func (s *Server) searchAll(c fiber.Ctx, searches []typesense.SearchParams) ([]typesense.SearchResult, error) {
	start := time.Now()
	results, err := s.ts.SearchAll(c.Context(), searches)
	t := timingOf(c)
	t.typesense += time.Since(start)
	t.chunks += len(searches)
	for _, result := range results {
		t.searchMS += result.SearchTimeMS
	}
	return results, err
}

// search is one search, timed.
func (s *Server) search(c fiber.Ctx, params typesense.SearchParams) (typesense.SearchResult, error) {
	results, err := s.searchAll(c, []typesense.SearchParams{params})
	if err != nil || len(results) == 0 {
		return typesense.SearchResult{}, err
	}
	return results[0], nil
}

// sendJSON is c.JSON with the encode time and size recorded, and the hops so far sent as Server-Timing.
func sendJSON(c fiber.Ctx, v any) error {
	start := time.Now()
	if err := c.JSON(v); err != nil {
		return err
	}
	t := timingOf(c)
	t.encode = time.Since(start)
	t.bytes = len(c.Response().Body())
	c.Set("Server-Timing", fmt.Sprintf("typesense;dur=%s, search;dur=%d, encode;dur=%s", millis(t.typesense), t.searchMS, millis(t.encode)))
	return nil
}

// millis renders a duration as milliseconds with one decimal, the unit both the log and Server-Timing use.
func millis(d time.Duration) string {
	return fmt.Sprintf("%.1f", float64(d)/float64(time.Millisecond))
}
