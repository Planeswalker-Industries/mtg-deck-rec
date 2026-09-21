# Running the search index on the VPS

Companion to [`typesense-plan.md`](typesense-plan.md), which says *what* moves into the index and why. This is how to
stand it up and keep it running. Decided 2026-09-19: **self-hosted on the owner's VPS**, not Typesense Cloud.

**Two containers, deployed separately, one of them public.** [`deploy/typesense/`](../../deploy/typesense) and
[`deploy/search-api/`](../../deploy/search-api) are two compose files — a managed panel treats one file as one
application, and the two have different lifecycles. Only the API is reachable from outside; Typesense publishes no
port and is reached by name on a shared Docker network. So there is one hostname to route and certify, the Typesense
key never leaves the machine, and what does leave is a read token for Vercel and a write token for the worker, each
able to do less than the key it fronts. [`deploy/README.md`](../../deploy/README.md) is how the two fit together;
[`services/search-api/README.md`](../../services/search-api/README.md) is the service itself.

## What it holds, and how big

Four collections, rebuilt from Postgres at any time by one command — nothing in the index is a source of truth, so
losing the whole machine costs a rebuild and nothing else.

| Collection | Documents (2026-09-19, local catalog) |
|---|---|
| `cards` | 34,760 |
| `tags` | 4,535 |
| `commanders` | one per `commander_keys` row (129 on hosted) |
| `commander_cards` | one per (commander, card) play rate |

Typesense keeps the search index in RAM and the raw documents on disk; the rule of thumb is **2–3× the size of the
indexed fields**. Ours are names, type lines, tag UUIDs and numerics, so **plan on a few hundred MB of RAM** and check
against the real thing after the first build (`/metrics.json`). `commander_cards` is the one collection that grows
with the corpus — recheck it at 500 commanders.

## Standing it up

**1. Run it.** Two stacks and a network they share. **The Typesense stack creates it, so deploy that one first** —
nothing needs creating by hand, because a panel deploy cannot run `docker network create` and requiring it is what
produced `Could not attach to network mtg-search: network mtg-search not found` on a first deploy.

```sh
cd deploy/typesense
cp .env.example .env    # TYPESENSE_ADMIN_KEY
docker compose up -d

cd ../search-api
cp .env.example .env    # the same TYPESENSE_ADMIN_KEY, plus the two tokens
docker compose up -d --build

docker compose ps       # in each; wait for "healthy"
```

Three secrets, and they are three for a reason. `TYPESENSE_ADMIN_KEY` never leaves the VPS and is the one value both
stacks need. `SEARCH_API_TOKEN` goes to Vercel and can only read. `SEARCH_API_ADMIN_TOKEN` goes to the worker and
the sync workflow and can also write. The API refuses to start if the two tokens match, or if any of the three is
empty.

Neither container faces the internet on its own. **Typesense publishes no port at all** — search-api reaches it by
the `typesense` alias on the shared network. search-api publishes **127.0.0.1:8090**, for a proxy on the host and
for `curl 127.0.0.1:8090/v1/health` when something is wrong. Keep that `127.0.0.1:` prefix: Docker writes iptables
rules that bypass `ufw` for published ports, so `0.0.0.0:8090` is reachable from the internet whatever the firewall
says.

`SEARCH_API_PORT` is the one port here that can collide with something else on the machine; set it in
`deploy/search-api/.env` if 8090 is taken. The ports *inside* the containers — Typesense's 8108 and search-api's
`SEARCH_API_CONTAINER_PORT` — cannot, because a container has its own network namespace; another service on the
host using the same number is not a conflict. A panel asking "which container port?" wants
`SEARCH_API_CONTAINER_PORT` (8080 unless you change it), and changing it carries the Traefik label and the health
probe along with it.

**After the first deploy, order stops mattering, and a Typesense outage does not take the API down with it.** Measured: stop the Typesense
stack and the API container stays *healthy* across several probe intervals while `/v1/health` returns 503 and
`/v1/health/live` returns 200. That split is deliberate — the container probe asks liveness, because a readiness
probe would have a panel restart-looping the API and Traefik pulling it out of the router over a dependency outage
the web app already falls back from. Start Typesense again and the API recovers on its own.

Two things worth knowing about those containers. Both healthchecks avoid `curl`, because neither image has it — the
Typesense image ships no shell tools beyond `bash`, whose `/dev/tcp` can just about speak HTTP, and the search-api
image is distroless, so `search-api healthcheck` is a mode of the binary itself. A healthcheck that cannot run marks
a working container unhealthy forever, which is what the first version of this file did. And there is no backup
story on purpose: nothing in the index is a source of truth, so losing the volume costs one `--rebuild`, and
restoring from Postgres is both faster and always correct.

**2. Put TLS in front of search-api.**

*A proxy on the host* (nginx, Caddy) reaches it through that loopback port. nginx, with `certbot --nginx -d <host>`
for the certificate:

```nginx
server {
  listen 443 ssl;
  server_name search.example.com;

  ssl_certificate     /etc/letsencrypt/live/search.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/search.example.com/privkey.pem;

  location / {
    proxy_pass http://127.0.0.1:8090;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
  }
}
```

Caddy is two lines and gets its own certificate: `search.example.com { reverse_proxy 127.0.0.1:8090 }`.

*Traefik in Docker* cannot use a loopback port at all. It discovers containers by label and connects to them
container to container, so search-api has to join Traefik's network and carry a router. The same compose file does
this — one file rather than two, because a managed panel usually points at a single compose path and cannot be told
to merge an override. Four lines in `.env`:

```sh
# beside the three secrets:
#   TRAEFIK_ENABLE=true
#   TRAEFIK_EXTERNAL=true
#   SEARCH_API_HOST=search.example.com
#   TRAEFIK_NETWORK=traefik          # if yours is called something else
docker compose up -d
```

`TRAEFIK_ENABLE` turns the labels on; `TRAEFIK_EXTERNAL` joins Traefik's existing network instead of an unused local
one. **Both are needed** — labels on a container Traefik cannot reach do nothing, and with `external` set the name
has to be right, because compose then fails `up` loudly rather than quietly starting a container nothing can route
to. With neither set, the labels say `traefik.enable=false` and the network is an ordinary unused bridge, which is
what makes one file safe for the nginx case.

**If a panel manages the host** — Dokploy, Coolify and the like, which generate
`<project>-<service>-<hash>.sslip.io` names — set the domain and container port **8080** in the panel for the
**search-api** service, not for Typesense, and let it write the labels. Hand-written labels there are overwritten on
the next deploy. Dokploy also deploys each compose file as a separate app on a shared Swarm network, which changes
how these two find each other and where the index should live:
[`deploy/README.md`](../../deploy/README.md) has a section for it, and it is worth reading before the first deploy
rather than after.

*Diagnosing Traefik:* a self-signed `CN=TRAEFIK DEFAULT CERT` and a bare `404 page not found` are **one problem, not
two** — Traefik only requests a certificate for a hostname it has a router rule for, so a missing router produces
both. Check the router before suspecting ACME. Port 80 also has to be reachable: the HTTP-01 challenge uses it even
though you will only ever call 443.

```sh
curl -k https://<host>/v1/health      # 404 page not found -> Traefik is up, no router for this host
curl http://127.0.0.1:8090/v1/health  # {"ok":true}        -> the stack is fine, it is only the routing
```

The second command is what tells "the search stack is broken" apart from "Traefik is not routing to it".

Whichever route, the endpoint is ready when this succeeds **without** `-k`:

```sh
curl https://<host>/v1/health         # {"ok":true}
```

**3. Build the index.**

```sh
SEARCH_API_URL=https://<host> SEARCH_API_ADMIN_TOKEN=... \
  yarn workspace @mtg/worker cli:hosted sync:typesense --rebuild
```

**4. Point things at it.**

| Where | Variables |
|---|---|
| Vercel (Production **and** Preview) | `SEARCH_API_URL`, `SEARCH_API_TOKEN` |
| GitHub Actions secrets (the daily sync) | `SEARCH_API_URL`, `SEARCH_API_ADMIN_TOKEN` |
| `apps/worker/.env.hosted` (this PC: corpus rebuilds, deck lookups) | `SEARCH_API_URL`, `SEARCH_API_ADMIN_TOKEN` |

Unset anywhere is a working configuration — that side just reads Postgres.

## Keeping it in step

Every table a document is built from has a trigger that writes the document's key into `public.search_index_queue`.
Three things drain it:

- **Each finished sync**, from `finishRun` — `sync:catalog`, `sync:printings`, `sync:tags`, `aggregate:corpus`.
- **The daily workflow**, as a final sweep (`.github/workflows/sync.yml`), which also catches a job that skipped as
  unchanged or a drain that failed.
- **By hand**: `yarn workspace @mtg/worker cli:hosted sync:typesense`.

Nothing in Postgres talks to Typesense, so the index's credentials never go near the database and a network hop can
never slow down or fail a sync transaction.

### What to do when

| Situation | Do |
|---|---|
| Queue is growing and not draining | `cli:hosted sync:typesense`, and read its error. It stops rather than looping. |
| Results look stale or wrong | `cli:hosted sync:typesense --rebuild`. Safe at any time: it builds a new versioned collection and moves the alias only when it is complete. |
| A schema field was added in `@mtg/core/search` | `--rebuild`. A new field needs a new collection; a plain drain cannot add one. |
| Disk or memory filling up | A `--rebuild` drops every stale version of each collection, not just the one the alias pointed at — a rebuild that died before moving its alias leaves a full copy behind, and Typesense loads every collection it has into memory at startup. `GET /collections` should show exactly four. |
| Upgrading Typesense | Bump the tag in `deploy/typesense/docker-compose.yml`, `docker compose up -d`, then `--rebuild`. The API stays up throughout and serves 503s meanwhile. |
| Deploying a new search-api | `docker compose up -d --build` in `deploy/search-api/` — Typesense is a separate stack and is not restarted. In-flight imports finish first: the service waits up to 30 s on shutdown so the worker never has to guess whether its batch landed. |
| Untrusted certificate, or a bare 404 behind Traefik | One cause: no router for that hostname, and it has to point at **search-api**, not Typesense. See "Diagnosing Traefik" above. |
| `502` from the API while both containers are healthy | search-api reached Typesense and got an error back; `docker compose logs search-api` names it. |
| The API will not start | It refuses an empty key, an empty token, or two identical tokens, and says which. |
| `port is already allocated` | Only `SEARCH_API_PORT` can do that; set it in `deploy/search-api/.env`. A port *inside* a container never collides with the host. |
| `network ... declared as external, but could not be found` | The search-api stack went first. Deploy `deploy/typesense/` — it is what creates the network — then this one. On a panel, use the panel's own network instead: `SEARCH_NETWORK` and `SEARCH_NETWORK_EXTERNAL=true` on both apps. |
| The index is empty after a redeploy | A panel that re-clones the repo replaced the `./data` bind mount. Set `TYPESENSE_DATA_DIR` to an absolute path outside the clone, then `--rebuild`. |
| API healthy but `/v1/health` says 503 after changing `SEARCH_NETWORK` | Compose reused the running container and left it on the old network. `docker compose up -d --force-recreate`. |
| The VPS is down | Nothing breaks. Every read path falls back to Postgres and logs. Rebuild when it is back. |

### Checks

```sh
yarn workspace @mtg/web tsx scripts/search-index-check.ts                        # fallback survives a broken index (no DB, no index; runs in CI)
yarn workspace @mtg/web tsx --env-file=.env.local scripts/search-parity-check.ts # the index agrees with Postgres (needs both, local only)
cd services/search-api && go test ./...                                          # the API itself; it fakes Typesense
```

## Local development

A separate compose file at the repo root, so the local one can be thrown away without touching the deployment:

```sh
docker compose -f docker-compose.search.yml up -d --build   # Typesense 56325, search API 56326
yarn workspace @mtg/worker cli sync:typesense --rebuild
```

Then in `apps/web/.env.local`:

```
SEARCH_API_URL=http://localhost:56326
SEARCH_API_TOKEN=mtg-local-read
```

It uses a named volume and fixed development tokens on loopback-only ports, where the deployment uses a bind mount
and real ones.

Then in `apps/web/.env.local`:

```
SEARCH_API_URL=http://localhost:56326
SEARCH_API_TOKEN=mtg-local-read
```

Leave them out to work the way CI does, against Postgres alone.

## Measured, so far

- A worst-case `sync:catalog --force` rewrites all 34,760 card rows: **1.57 s without the triggers, 2.99 s with** —
  about 41 µs per row to enqueue. The daily price update touches far fewer.
- A full rebuild of all four collections from the local catalog: **about 6 s**, 39,295 documents.
- A whole-collection sentinel (a tag-hierarchy change) reindexes 34,760 cards in **about 6 s**.
- The container reports healthy about 40 s after `up -d`, most of which is the 10 s `start_period`.
- Card rows rebuilt from documents are **byte-identical** to the same rows read from Postgres, across a 500-card
  sample (`search-parity-check.ts`).
