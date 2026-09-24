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

// crawlPreflightTimeout bounds the one read a scrape makes before it answers. It is deliberately well under the web
// app's 30 s trigger timeout and under the Supabase client's own 30 s: a network that swallows the request would
// otherwise let the preflight run until the caller had already given up, and the cron would record a fetch abort
// instead of the 502 that says what is wrong.
const crawlPreflightTimeout = 10 * time.Second

// crawlScrape kicks off a crawl for the named source and answers without waiting for it. The crawl runs in the
// background: a backfill can take hours, and the web app's cron function must not wait on the crawl's lifetime.
//
// What it does *not* do is answer before it knows the crawl can start. The 202 means "a crawl began", so it is
// preceded by one read against the crawl's database — the same read the run makes first. Everything after that point
// is genuinely fire-and-forget and reports itself only to the log; everything before it is the caller's to hear about.
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
	// One read on the request's own context, before the 202. A crawl that cannot reach its database fails on this
	// exact call a moment later, in the background, where the only evidence is a line in the container log — so the
	// caller is told now, while it is still listening. Vercel records a failed cron; silence is no longer the symptom.
	//
	// After the busy check on purpose: an already-running source still answers without touching the database, which
	// is what keeps a caller that can reach this endpoint from spending a round trip per request.
	preflightCtx, cancel := context.WithTimeout(c.Context(), crawlPreflightTimeout)
	defer cancel()
	if err := runner.Preflight(preflightCtx); err != nil {
		s.crawling.Delete(source)
		s.log.Error("crawl preflight failed", "source", source, "err", err)
		return &apiError{status: fiber.StatusBadGateway,
			message: "the crawl's database did not answer, so no crawl was started (check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on this host)"}
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
