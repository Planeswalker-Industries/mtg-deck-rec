package api

import (
	"context"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
)

// crawlDrainTimeout bounds how long shutdown waits for a background crawl to notice it was cancelled and write its
// closing bookkeeping. A crawl itself can run for hours, so this is not "wait for the crawl" - it is "give the run
// long enough to record that it stopped and let go of its claim", which is two database calls.
const crawlDrainTimeout = 20 * time.Second

// crawlScrape kicks off a crawl for the named source and answers immediately. The crawl runs in the background: a
// backfill can take hours, and the web app's cron function must not wait on the crawl's lifetime.
//
// At most one goroutine per source exists at a time. The database claim already makes a second crawl a no-op, but a
// caller that can reach this endpoint should not be able to spend a round trip to the database per request either.
func (s *Server) crawlScrape(c fiber.Ctx) error {
	source := c.Params("source")
	runner, err := s.resolveCrawl(c)
	if err != nil {
		return err
	}
	if _, busy := s.crawling.LoadOrStore(source, true); busy {
		return c.Status(fiber.StatusAccepted).JSON(fiber.Map{"started": false, "reason": "already running"})
	}
	s.crawlWG.Add(1)
	go func() {
		defer s.crawlWG.Done()
		defer s.crawling.Delete(source)
		s.runCrawl(source, runner)
	}()
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

// runCrawl logs a background crawl's outcome. It runs on the server's own context, not a request's: the request
// returned 202 long ago. Shutdown cancels that context, and the run's closing writes are detached from it, so an
// interrupted crawl still releases its claim instead of leaving the source locked.
func (s *Server) runCrawl(source string, runner *crawl.Runner) {
	start := time.Now()
	res, err := runner.Run(s.crawlCtx)
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
		"unqualified", res.Summary.SkippedUnqualified,
		"blocks", res.Summary.Blocks,
	)
}

// stopCrawls cancels any running crawl and waits, briefly, for it to finish recording itself. Called from the app's
// post-shutdown hook: Fiber's own shutdown only waits for in-flight *requests*, and a scrape's request ended at its
// 202, so without this a deploy landing mid-crawl would kill the process with the source still claimed.
func (s *Server) stopCrawls() {
	s.crawlStop()
	done := make(chan struct{})
	go func() {
		s.crawlWG.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(crawlDrainTimeout):
		s.log.Warn("a crawl did not stop in time; its claim will be taken over as stale")
	}
}

// newCrawlContext is the context every background crawl runs on, cancelled at shutdown.
func newCrawlContext() (context.Context, context.CancelFunc) {
	return context.WithCancel(context.Background())
}
