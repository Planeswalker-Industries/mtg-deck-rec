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
}

func Load() (Config, error) {
	c := Config{
		Addr:             env("SEARCH_API_ADDR", ":8080"),
		TypesenseURL:     strings.TrimRight(env("TYPESENSE_URL", "http://typesense:8108"), "/"),
		TypesenseKey:     os.Getenv("TYPESENSE_ADMIN_KEY"),
		ReadToken:        os.Getenv("SEARCH_API_TOKEN"),
		AdminToken:       os.Getenv("SEARCH_API_ADMIN_TOKEN"),
		TypesenseTimeout: 10 * time.Second,
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

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
