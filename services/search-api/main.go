// Command search-api puts a narrow HTTP surface in front of Typesense.
//
// Nothing else in the project talks to Typesense directly: the web app reads through this service, the worker writes
// through it, and Typesense itself is reachable only on the Docker network. That means the search index's admin key
// exists in exactly one place, and the tokens that do leave the VPS can do less than it can.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/api"
	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/config"
	"github.com/Planeswalker-Industries/mtg-deck-rec/services/search-api/internal/typesense"
)

func main() {
	// `search-api healthcheck` asks this process's own /v1/health and exits 0 or 1. The container image is
	// distroless — no shell, no curl, no wget — so the binary has to be able to check itself, or the healthcheck
	// is one that can never run. (Learned from the Typesense image, whose obvious healthcheck marked a working
	// container unhealthy forever.)
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		os.Exit(healthcheck())
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	cfg, err := config.Load()
	if err != nil {
		log.Error("refusing to start", "err", err)
		os.Exit(1)
	}

	client := typesense.New(cfg.TypesenseURL, cfg.TypesenseKey, cfg.TypesenseTimeout)
	app := api.New(cfg, client, log)

	// Typesense may still be starting; say so and carry on rather than refusing to boot. /v1/health reports the
	// truth either way, and the app falls back to Postgres while this is unhealthy.
	probe, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	if err := client.Health(probe); err != nil {
		log.Warn("typesense did not answer at startup", "err", err, "url", cfg.TypesenseURL)
	}
	cancel()

	go func() {
		log.Info("listening", "addr", cfg.Addr, "typesense", cfg.TypesenseURL)
		if err := app.Listen(cfg.Addr); err != nil {
			log.Error("server stopped", "err", err)
			os.Exit(1)
		}
	}()

	// A bulk import can be mid-flight when a deploy replaces this container; let it finish rather than leaving the
	// worker to guess whether its batch landed.
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	log.Info("shutting down")
	if err := app.ShutdownWithTimeout(30 * time.Second); err != nil {
		log.Error("shutdown", "err", err)
	}
}

// healthcheck is the container's own probe: it talks to this process over loopback, so it proves the HTTP server is
// serving rather than merely that the process exists.
func healthcheck() int {
	addr := os.Getenv("SEARCH_API_ADDR")
	if addr == "" {
		addr = ":8080"
	}
	client := &http.Client{Timeout: 3 * time.Second}
	res, err := client.Get("http://127.0.0.1" + addr + "/v1/health")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		fmt.Fprintf(os.Stderr, "health returned %d\n", res.StatusCode)
		return 1
	}
	return 0
}
