// Package api is the HTTP surface the rest of the project talks to. Typesense itself is never reachable from
// outside this service.
//
// The endpoints are shaped around the questions the app asks, not around Typesense's REST API. A pass-through proxy
// would be Typesense again with extra latency; this way a 500-card fetch is one request whose chunking, paging and
// ranking live here, and the caller sends what it means.
package api

import (
	"errors"
	"log/slog"
	"regexp"
	"strings"

	"github.com/gofiber/fiber/v3"

	"github.com/wuddat/mtg-deck-rec/services/search-api/internal/config"
	"github.com/wuddat/mtg-deck-rec/services/search-api/internal/typesense"
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

type Server struct {
	ts  *typesense.Client
	cfg config.Config
	log *slog.Logger
}

func New(cfg config.Config, ts *typesense.Client, log *slog.Logger) *fiber.App {
	s := &Server{ts: ts, cfg: cfg, log: log}

	app := fiber.New(fiber.Config{
		AppName:      "mtg search-api",
		ErrorHandler: s.errorHandler,
		// Bulk imports arrive as JSONL and a full card collection is tens of MB.
		BodyLimit: 64 * 1024 * 1024,
	})

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

// authorize accepts any of the given bearer tokens. Comparison is constant-time-ish by length and content via
// subtle-free equality on short strings; these are long random tokens over TLS, and the threat this guards is a
// missing or wrong token, not a timing oracle.
func (s *Server) authorize(accepted ...string) fiber.Handler {
	return func(c fiber.Ctx) error {
		header := c.Get("Authorization")
		token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
		if token == "" || header == token {
			return &apiError{status: fiber.StatusUnauthorized, message: "a bearer token is required"}
		}
		for _, want := range accepted {
			if want != "" && token == want {
				return c.Next()
			}
		}
		return &apiError{status: fiber.StatusForbidden, message: "that token is not allowed here"}
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
