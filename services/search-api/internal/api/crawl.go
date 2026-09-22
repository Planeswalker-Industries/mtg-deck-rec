package api

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// crawlScrape kicks off a crawl for the named source and answers immediately. The crawl runs in the background: a
// backfill can take hours, and the web app's cron function must not wait on the crawl's lifetime. Each source's
// atomic claim makes overlapping triggers a no-op, so firing twice in a row is safe.
func (s *Server) crawlScrape(c fiber.Ctx) error {
	runner, err := s.resolveCrawl(c)
	if err != nil {
		return err
	}
	go s.runCrawl(c.Params("source"), runner)
	return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"started": true})
}

// crawlStatus reports a source's crawl state: is the source blocked, is a crawl running, how far it got.
func (s *Server) crawlStatus(c fiber.Ctx) error {
	runner, err := s.resolveCrawl(c)
	if err != nil {
		return err
	}
	status, err := runner.Status(c.Context())
	if err != nil {
		s.log.Error("crawl status", "source", c.Params("source"), "err", err)
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "the crawl's database did not answer"})
	}
	return c.JSON(status)
}

// resolveCrawl looks up the /cron/:source param. An absent runner - unknown source or the crawl not configured - is
// a 503, because a source that was never wired up is a misconfiguration, not a request the caller can fix.
func (s *Server) resolveCrawl(c fiber.Ctx) (*crawl.Runner, error) {
	runner := s.crawls[c.Params("source")]
	if runner == nil {
		return nil, &apiError{status: fiber.StatusServiceUnavailable,
			message: "the crawl is not configured for this source (missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SEARCH_API_CRON_TOKEN)"}
	}
	return runner, nil
}

// runCrawl logs a background crawl's outcome. The whole process's graceful shutdown waits 30s, which is enough for
// the run's deferred finish writes; the crawl itself is resumable from corpus.crawl_state, so an interrupted run is
// a lost batch, not a corrupted one.
func (s *Server) runCrawl(source string, runner *crawl.Runner) {
	start := time.Now()
	res, err := runner.Run(context.Background())
	if err != nil {
		s.log.Error("crawl failed", "source", source, "err", err)
		return
	}
	if res.AlreadyBusy || res.Summary.State == "failed" {
		s.log.Warn("crawl did nothing",
			"source", source,
			"alreadyBusy", res.AlreadyBusy,
			"state", res.Summary.State,
			"error", res.Summary.Error)
		return
	}
	s.log.Info("crawl finished",
		"source", source,
		"run", res.RunID,
		"state", res.Summary.State,
		"elapsed", time.Since(start).Round(time.Second),
		"pages", res.Summary.PagesSeen,
		"decks", res.Summary.DecksListed,
		"fetched", res.Summary.DecksFetched,
		"written", res.Summary.DecksWritten,
		"skipped", res.Summary.SkippedUnchanged,
		"blocks", res.Summary.Blocks,
	)
}
