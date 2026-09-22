// Package api is the HTTP surface the rest of the project talks to. Typesense itself is never reachable from
// outside this service.
//
// The endpoints are shaped around the questions the app asks, not around Typesense's REST API. A pass-through proxy
// would be Typesense again with extra latency; this way a 500-card fetch is one request whose chunking, paging and
// ranking live here, and the caller sends what it means.
package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/config"
	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/crawl"
	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/typesense"
)

// Collection names, matching packages/core/src/search/documents.ts. Read endpoints name their own collection, so a
// caller can never reach one it was not meant to.
const (
	cardsCollection          = "cards"
	tagsCollection           = "tags"
	commandersCollection     = "commanders"
	commanderCardsCollection = "commander_cards"
)

// What a collection name may look like when the worker supplies one (`cards`, `cards_1789871965305`). Anything else
// is refused rather than escaped, because the name goes into a URL path.
var collectionName = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// Slugs the catalog generates. Checked for the same reason: it reaches a filter expression.
var slugShape = regexp.MustCompile(`^[a-z0-9-]{1,120}$`)

// The deck-grouping categories, spelled exactly as cardCategory in @mtg/core writes them into card_category. A
// closed set rather than a general shape: the filter is built into a query string, and the only values that can
// match anything are these eight.
var categoryShape = regexp.MustCompile(`^(creature|planeswalker|battle|instant|sorcery|artifact|enchantment|land)$`)

type Server struct {
	ts  *typesense.Client
	cfg config.Config
	log *slog.Logger
	// crawls maps source names to their runner. Empty (or missing an entry) when a source isn't wired up - the
	// handlers answer 503, never a broken crawl.
	crawls map[string]*crawl.Runner
	// The background crawls' lifetime: one context for all of them, cancelled at shutdown, a WaitGroup to drain
	// them, and the set of sources currently crawling so a source can only have one goroutine at a time.
	crawlCtx  context.Context
	crawlStop context.CancelFunc
	crawlWG   sync.WaitGroup
	crawling  sync.Map
}

func New(cfg config.Config, ts *typesense.Client, log *slog.Logger, crawls map[string]*crawl.Runner) *fiber.App {
	crawlCtx, crawlStop := newCrawlContext()
	s := &Server{ts: ts, cfg: cfg, log: log, crawls: crawls, crawlCtx: crawlCtx, crawlStop: crawlStop}

	app := fiber.New(fiber.Config{
		AppName:      "mtg search-api",
		ErrorHandler: s.errorHandler,
		// Bulk imports arrive as JSONL and a full card collection is tens of MB.
		BodyLimit: 64 * 1024 * 1024,
	})

	// Before the routes, so it sees every request including the ones that match nothing.
	app.Use(s.requestLog())

	app.Get("/v1/health", s.health)
	app.Get("/v1/health/live", s.live)

	read := app.Group("/v1", s.authorize(cfg.ReadToken, cfg.AdminToken))
	read.Post("/cards/by-id", s.cardsByID)
	read.Get("/cards/search", s.cardsSearch)
	read.Get("/pages/:kind/:slug", s.pageExists)
	read.Get("/tags", s.allTags)
	read.Post("/commander-cards/rates", s.commanderCardRates)
	read.Get("/commander-cards/top", s.commanderCardsTop)

	// The admin token alone. The read token is on Vercel, where a leak should not be able to drop a collection.
	admin := app.Group("/v1/admin", s.authorize(cfg.AdminToken))
	admin.Get("/collections", s.listCollections)
	admin.Post("/collections", s.createCollection)
	admin.Delete("/collections/:name", s.dropCollection)
	admin.Post("/collections/:name/import", s.importDocuments)
	admin.Delete("/collections/:name/documents/:id", s.deleteDocument)
	admin.Get("/aliases/:name", s.getAlias)
	admin.Put("/aliases/:name", s.putAlias)

	// The deck crawls, triggered by the web app's daily cron, one group per source (:source ∈ {moxfield, archidekt}).
	// Only the cron token (and the admin token) reach them; the read token on Vercel cannot. They live outside /v1 on
	// purpose: the read group's authorize is a Use on /v1 that would otherwise intercept every path below it (Fiber
	// mounts a group's middleware at the prefix), and the whole point is that a cron trigger is not a read. When a
	// source isn't configured its handler answers 503, so an existing deploy predating the crawls keeps serving
	// search with the same three secrets.
	crawlGroup := app.Group("/cron/:source", s.authorize(cfg.CronToken, cfg.AdminToken))
	crawlGroup.Post("/scrape", s.crawlScrape)
	crawlGroup.Get("/status", s.crawlStatus)

	// A crawl outlives the request that started it, so the server has to be the thing that ends it.
	app.Hooks().OnPostShutdown(func(error) error {
		s.stopCrawls()
		return nil
	})

	return app
}

// apiError is an error with a status code attached, so handlers can say what went wrong without each one formatting
// its own response.
type apiError struct {
	status  int
	message string
}

func (e *apiError) Error() string { return e.message }

func badRequest(message string) error {
	return &apiError{status: fiber.StatusBadRequest, message: message}
}

func (s *Server) errorHandler(c fiber.Ctx, err error) error {
	status := fiber.StatusInternalServerError
	message := "the search service could not answer"

	var apiErr *apiError
	var tsErr *typesense.Error
	switch {
	case errors.As(err, &apiErr):
		status, message = apiErr.status, apiErr.message
	case errors.As(err, &tsErr):
		// A Typesense 404 is a missing collection, which from outside is this service being unready, not the
		// caller's mistake. Everything else it says is ours to own too.
		status = fiber.StatusBadGateway
		message = "the search index could not answer"
		s.log.Error("typesense", "status", tsErr.Status, "body", tsErr.Body, "path", c.Path())
	default:
		s.log.Error("request failed", "err", err, "path", c.Path())
	}
	return c.Status(status).JSON(fiber.Map{"error": message})
}

// authorize accepts any of the given bearer tokens. The comparison is constant-time because these tokens gate
// writes and outbound crawling; subtle.ConstantTimeCompare costs nothing here and removes the question.
func (s *Server) authorize(accepted ...string) fiber.Handler {
	return func(c fiber.Ctx) error {
		header := c.Get("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		if token == "" || header == token {
			return &apiError{status: fiber.StatusUnauthorized, message: "a bearer token is required"}
		}
		allowed := false
		for _, want := range accepted {
			if want != "" && subtle.ConstantTimeCompare([]byte(token), []byte(want)) == 1 {
				allowed = true
			}
		}
		if allowed {
			return c.Next()
		}
		return &apiError{status: fiber.StatusForbidden, message: "that token is not allowed here"}
	}
}

// healthPaths are the probes. They are the only requests not logged: the container asks one every few seconds, and a
// log that is almost entirely health checks is one nobody reads.
var healthPaths = map[string]bool{"/v1/health": true, "/v1/health/live": true}

// requestLog records one line per request. Without it the service is silent unless something fails, which makes
// "is anything calling this?" unanswerable from the outside — the question is not hypothetical: it cost an afternoon
// once, because a successful search and no search at all look identical in the log.
//
// The query string is deliberately left out. A search term is a person's words, and `q=` would put every one of them
// in the log; the path alone answers which endpoint was reached. The Authorization header is never touched.
func (s *Server) requestLog() fiber.Handler {
	return func(c fiber.Ctx) error {
		if healthPaths[c.Path()] {
			return c.Next()
		}
		start := time.Now()
		err := c.Next()

		// A handler that returned an error has not reached the error handler yet, so the response still carries its
		// pre-error status. Report the error itself rather than a misleading 200.
		attrs := []any{"method", c.Method(), "path", c.Path(), "ms", time.Since(start).Milliseconds()}
		if err != nil {
			attrs = append(attrs, "err", err.Error())
		} else {
			attrs = append(attrs, "status", c.Response().StatusCode())
		}
		s.log.Info("request", attrs...)
		return err
	}
}

// health is readiness: can this service actually do its job, which means Typesense answering. Unauthenticated,
// because a load balancer needs it, and deliberately shallow — saying more than "ok" to an anonymous caller tells
// them about the inside.
func (s *Server) health(c fiber.Ctx) error {
	if err := s.ts.Health(c.Context()); err != nil {
		s.log.Warn("health: typesense did not answer", "err", err)
		return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{"ok": false})
	}
	return c.JSON(fiber.Map{"ok": true})
}

// live is liveness: is this process serving HTTP. It deliberately says nothing about Typesense.
//
// The container's healthcheck asks *this* one. If it asked the readiness endpoint, a Typesense outage would mark a
// perfectly working API unhealthy — which means a panel restart-looping it and Traefik pulling it out of the
// router, turning an honest 503 that the app already falls back from into a connection failure. Measured: stop the
// Typesense stack and /v1/health returns 503 while this still returns 200, which is the distinction that matters.
func (s *Server) live(c fiber.Ctx) error {
	return c.JSON(fiber.Map{"ok": true})
}
