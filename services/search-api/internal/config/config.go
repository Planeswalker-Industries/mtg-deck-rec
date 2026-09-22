// Package config reads the service's settings from the environment, and refuses to start without the ones that
// have no safe default. A search API that boots with an empty token is worse than one that does not boot.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	// Where this service listens. Inside Docker that is every interface; what the internet can reach is decided by
	// the reverse proxy in front, not here.
	Addr string

	// Typesense, reached over the Docker network. Never exposed publicly: this service is the only thing that
	// holds its admin key, which is the whole point of putting it here.
	TypesenseURL     string
	TypesenseKey     string
	TypesenseTimeout time.Duration

	// Callers. The web app gets ReadToken; the worker and the sync workflow get AdminToken. Separate values, so a
	// token leaked from a Vercel function cannot drop a collection.
	ReadToken  string
	AdminToken string

	// The deck crawls. Optional: when any of these is empty the crawl endpoints answer 503, a configured-but-
	// disabled state, and the existing deploy boots unchanged.
	SupabaseURL string // the project URL, e.g. https://<ref>.supabase.co
	// service_role, today. It bypasses RLS across the whole database, which is more than the crawl needs: the
	// public.crawl_* functions are what narrow the crawl to its own schema, and a dedicated role is open work
	// (T036). Supabase's secret keys map to service_role, so a lesser one means minting a JWT for a custom role.
	SupabaseServiceKey string
	CronToken          string // the web app's. It can trigger a scrape, nothing else (the split the tokens exist for)
	SupabaseTimeout    time.Duration
}

func Load() (Config, error) {
	c := Config{
		Addr:               env("SEARCH_API_ADDR", ":8080"),
		TypesenseURL:       strings.TrimRight(env("TYPESENSE_URL", "http://typesense:8108"), "/"),
		TypesenseKey:       os.Getenv("TYPESENSE_ADMIN_KEY"),
		ReadToken:          os.Getenv("SEARCH_API_TOKEN"),
		AdminToken:         os.Getenv("SEARCH_API_ADMIN_TOKEN"),
		TypesenseTimeout:   10 * time.Second,
		SupabaseURL:        strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"),
		SupabaseServiceKey: os.Getenv("SUPABASE_SERVICE_ROLE_KEY"),
		CronToken:          os.Getenv("SEARCH_API_CRON_TOKEN"),
		SupabaseTimeout:    30 * time.Second,
	}

	var missing []string
	for name, value := range map[string]string{
		"TYPESENSE_ADMIN_KEY":    c.TypesenseKey,
		"SEARCH_API_TOKEN":       c.ReadToken,
		"SEARCH_API_ADMIN_TOKEN": c.AdminToken,
	} {
		if value == "" {
			missing = append(missing, name)
		}
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required environment: %s", strings.Join(missing, ", "))
	}
	// The same value for both would make the read token an admin token, which is the one mistake this split exists
	// to prevent.
	if c.ReadToken == c.AdminToken {
		return Config{}, fmt.Errorf("SEARCH_API_TOKEN and SEARCH_API_ADMIN_TOKEN must differ")
	}
	return c, nil
}

// CrawlConfigured reports whether the deck crawls are wired up: a project URL, a service key and a cron token.
// All three are needed; the crawl endpoints answer 503 when it is false, so a deploy that predates the scrape
// still boots and serves search unchanged.
func (c Config) CrawlConfigured() bool {
	return c.SupabaseURL != "" && c.SupabaseServiceKey != "" && c.CronToken != ""
}

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
