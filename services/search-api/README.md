# search-api

The only thing in this project that talks to Typesense. The web app reads through it, the worker writes through it,
and Typesense itself is reachable only on the private Docker network beside it.

Why it exists:

- **The Typesense key stays on the VPS.** What leaves is a read token (the web app) and a write token (the worker
  and the sync workflow), each able to do strictly less than the key it fronts.
- **One public service to route and certify** instead of exposing a search engine directly.
- **The batching lives here.** A 500-card fetch is one request whose chunking, paging and ranking happen on this
  side, rather than every caller rebuilding them.

It is not a Typesense proxy. The endpoints are shaped around the questions the project asks; a pass-through would be
Typesense again with extra latency.

## Endpoints

Two unauthenticated health endpoints, because they answer different questions. `GET /v1/health` is **readiness**: it
reports whether Typesense answers. `GET /v1/health/live` is **liveness**: only that this process is serving. The
container probe asks liveness — a probe on readiness would have a panel restart-looping this service, and Traefik
pulling it out of the router, over a dependency outage the web app already falls back from.

Everything else takes `Authorization: Bearer <token>`.

| Endpoint | Token | For |
|---|---|---|
| `POST /v1/cards/by-id` | read | `fetchCardsById` — a swap pool is 220 cards, an add pool 400, a commander page 500 |
| `GET /v1/cards/search` | read | the header search and the commander picker |
| `GET /v1/pages/:kind/:slug` | read | the proxy's real-404 check on every card and commander page view |
| `GET /v1/tags` | read | `fetchCardTags`, which needs every tag's label |
| `POST /v1/commander-cards/rates` | read | the play-rate half of `loadCardCorpus` |
| `GET /v1/commander-cards/top` | read | what a commander page ranks |
| `GET/POST/DELETE /v1/admin/collections…` | admin | the worker's drain and `--rebuild` |
| `GET/PUT /v1/admin/aliases/:name` | admin | the alias swap that makes a rebuild atomic |

The admin token also satisfies the read endpoints; the read token is refused on admin ones, and the service will not
start if the two are equal.

## Documents

Documents pass through as opaque JSON. Their shape is defined once, in `packages/core/src/search/documents.ts`, and
shared by the worker that writes them and the app that reads them — restating it in Go would give it a third
definition to drift from. The only fields this service knows by name are the two it must read to answer a question:
`card_id` and `slug`.

## Running it

```sh
go test ./...

TYPESENSE_URL=http://localhost:56325 TYPESENSE_ADMIN_KEY=... \
SEARCH_API_TOKEN=... SEARCH_API_ADMIN_TOKEN=... \
  go run .
```

Usually you want the whole stack instead: `docker compose -f ../../docker-compose.search.yml up -d --build`. On the
VPS the two run as separate compose files; see [`deploy/README.md`](../../deploy/README.md).

| Variable | Default | |
|---|---|---|
| `SEARCH_API_ADDR` | `:8080` | inside the container, so it cannot collide with a host service; the compose files set it from `SEARCH_API_CONTAINER_PORT` |
| `TYPESENSE_URL` | `http://typesense:8108` | by service name on the private network |
| `TYPESENSE_ADMIN_KEY` | — | required |
| `SEARCH_API_TOKEN` | — | required; the web app's |
| `SEARCH_API_ADMIN_TOKEN` | — | required; the worker's, must differ |

The image is a static binary on distroless. `search-api healthcheck` is a mode of that same binary, because there is
no shell in the image to run `curl` in — and a healthcheck that cannot run marks a working container unhealthy
forever, which is exactly what the Typesense image's own healthcheck did before it was fixed.
