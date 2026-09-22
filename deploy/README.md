# deploy

The search stack on the VPS, as **two independently deployed compose files**.

| Directory | What it runs | Faces the internet |
|---|---|---|
| [`typesense/`](typesense/) | Typesense | No — publishes no port at all |
| [`search-api/`](search-api/) | [`services/search-api`](../services/search-api) | Yes, behind a reverse proxy with TLS |

Two files rather than one because a managed panel treats one compose file as one application, and the two have
different lifecycles: the API is rebuilt whenever its Go code changes, while Typesense is a long-lived stateful
container you only touch to upgrade it.

## They meet on a shared network

**The Typesense stack creates it; the API stack joins it. Deploy Typesense first.** Nothing has to be created by
hand — a panel deploy cannot run `docker network create`, and requiring it is what produced

```
Could not attach to network mtg-search: network mtg-search not found
```

on a first deploy. Get the order wrong and the API refuses to start with `network mtg-search declared as external,
but could not be found`, which at least says what to do.

The Typesense service publishes the alias `typesense` on that network, which is the whole of
`TYPESENSE_URL=http://typesense:8108` in the API's environment.

**To use a network neither stack owns** — a panel's shared network, say — set `SEARCH_NETWORK` to its name and
`SEARCH_NETWORK_EXTERNAL=true` in **both** `.env` files. Then neither tries to create it and the order stops
mattering. Verified working on a network created separately. **On Dokploy this is the path to take** — see the
section below.

> Changing `SEARCH_NETWORK` on a stack that is already up needs `docker compose up -d --force-recreate`. Compose
> reuses a running container and leaves it on the old network, which looks like the API being healthy while
> `/v1/health` reports 503 — it is live, it just cannot see Typesense.

**Once the network exists the two are independent again.** Measured: stop the Typesense stack and the API keeps
running and stays *healthy* — its container probe asks liveness, not readiness — while `/v1/health` honestly returns
503 and the web app falls back to Postgres. Start Typesense again and it recovers on its own, with nothing to
restart.

## Secrets, each able to do less than the last

| Secret | Held by | Can |
|---|---|---|
| `TYPESENSE_ADMIN_KEY` | both stacks, never leaves the VPS | everything Typesense can do |
| `SEARCH_API_ADMIN_TOKEN` | the worker and the sync workflow | read and write the index |
| `SEARCH_API_TOKEN` | Vercel | read only |

`TYPESENSE_ADMIN_KEY` is the one duplicated value: it appears in both `.env` files, because Typesense is told to use
it and the API is told to present it. Changing it means changing it in both places and restarting both. The API
refuses to start if the two tokens match, or if any of the three is empty.

The **deck crawls** ([`docs/roadmap/deck-crawl.md`](../docs/roadmap/deck-crawl.md)) add three more to the search API,
all or nothing — with any of them empty the crawl endpoints answer 503 and search is unaffected:

| Secret | Held by | Can |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | the VPS, never Vercel | everything in the database — it bypasses RLS. Narrowing this to a dedicated role is open work (T036) |
| `SEARCH_API_CRON_TOKEN` | the VPS and Vercel | trigger a scrape, read a crawl's status |
| `CRON_SECRET` | **Vercel only** | nothing here — it is what the web app's cron route checks on the way in |

`SUPABASE_URL` goes beside them and is not a secret. `SEARCH_API_CRON_TOKEN` is the second duplicated value, for the
same reason as the Typesense key: one side presents it, the other checks it.

## Order to stand it up

```sh
cd deploy/typesense  && cp .env.example .env && $EDITOR .env && docker compose up -d   # creates the network
cd ../search-api     && cp .env.example .env && $EDITOR .env && docker compose up -d --build

curl http://127.0.0.1:8090/v1/health          # {"ok":true} — the stack works
curl https://<host>/v1/health                 # {"ok":true} — and the proxy routes to it
```

Then build the index, and point Vercel and the sync workflow at it. Both steps are in
[`docs/roadmap/typesense-ops.md`](../docs/roadmap/typesense-ops.md), which is the runbook this summarises.

## On Dokploy: use `deploy/dokploy/`

Dokploy runs each compose file as its own project — `docker compose -p <app> -f <path> up -d --build` — with
Traefik under Swarm. [`deploy/dokploy/`](dokploy/) holds a file per app, shaped for exactly that:

| Dokploy app | Compose path | Variables to set | Domain |
|---|---|---|---|
| Typesense | `deploy/dokploy/typesense.yml` | `TYPESENSE_ADMIN_KEY` | none |
| search API | `deploy/dokploy/search-api.yml` | `TYPESENSE_ADMIN_KEY` (same value), `SEARCH_API_TOKEN`, `SEARCH_API_ADMIN_TOKEN`, and for the deck crawls `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEARCH_API_CRON_TOKEN` | yes, container port **8080** |

They differ from the generic files above in three ways, each answering something a panel got wrong:

**The shared network is hardcoded to `dokploy-network`, not built from variables.** Compose interpolates the
`networks:` block from a `.env` *beside the compose file* or from the shell — **not** from a `.env` at the repo
root. Measured:

| Where `SEARCH_NETWORK` was set | Reached `networks:`? |
|---|---|
| `.env` at the repo root | **No** — silently stayed at the default |
| `.env` beside the compose file | Yes |
| Shell variable | Yes |

A variable that does not land in the right place leaves the network at its default and the deploy fails with
`Could not attach to network mtg-search: network mtg-search not found`. These files have no variable there to get
wrong.

**The data directory defaults to `/var/lib/mtg-typesense`**, outside the clone. Dokploy re-clones the repo on every
deploy, so a bind mount inside it would take the index with it — recoverable with `sync:typesense --rebuild`, but a
slow surprise.

**There are no Traefik labels**, so nothing of ours can win a label merge and leave the panel's domain without a
router. Add the domain in Dokploy against the search-api app, service `search-api`, container port **8080**.

### When the panel's domain does not produce a router

Symptom: the app deploys and is healthy, but the hostname answers `404 page not found` behind a
`CN=TRAEFIK DEFAULT CERT`. Those are **one problem, not two** — Traefik only requests a certificate for a hostname
it has a router for, so both say the same thing: no router exists.

Check whether the panel wrote any labels at all, on the VPS:

```sh
docker inspect search-api --format '{{json .Config.Labels}}' | tr ',' '\n' | grep traefik
```

Nothing back means the panel's domain never reached this container — most often because a Compose app needs the
domain pointed at a **service name** (`search-api`) and a container port (`8080`), not just a hostname.

If that cannot be made to work, [`search-api-traefik.yml`](dokploy/search-api-traefik.yml) is the same container
carrying our own router labels. Point the app's compose path at it, set `SEARCH_API_HOST` and
`TRAEFIK_CERT_RESOLVER`, and **remove the domain from the panel for that app** so two routers do not compete for one
hostname.

Either way, this is the command that tells you which half is broken:

```sh
curl 127.0.0.1:8090/v1/health    # on the box: {"ok":true} means only the routing is wrong
```

### Pointing the apps at these files

Merging a change that adds these files does not move an existing app onto them — **the compose path is a setting in
the panel**, and an app created earlier keeps pointing at whatever it was given. If a deploy still fails with
`network mtg-search not found` after these files exist, that is the reason: `mtg-search` is the default in
`deploy/search-api/docker-compose.yml`, so the app is still on the old path. Change it to
`deploy/dokploy/search-api.yml` (and `deploy/dokploy/typesense.yml` for the other app) in the app's settings, then
redeploy.

### If a deploy still cannot find the network

Check what compose actually resolved, on the VPS:

```sh
cd /etc/dokploy/compose/<app>/code
docker compose -p <app> -f ./deploy/dokploy/search-api.yml config | grep -A3 '^networks:'
```

It should say `name: dokploy-network`. Confirm that is what Dokploy calls it — `docker network ls | grep dokploy` —
and if not, the name is the one literal in these two files to change.

## Ports

Only one port here can collide with anything: **`SEARCH_API_PORT`**, the host port search-api publishes on loopback
(8090 by default). Change it in `deploy/search-api/.env` if something else on the VPS already has it.

Everything else is inside a container, where it cannot conflict with a host service or with another container
whatever either of them uses — Typesense's 8108 and search-api's `SEARCH_API_CONTAINER_PORT` (8080 by default).
Changing the latter carries the Traefik label and the health probe with it, so a panel asking "which container
port?" wants whatever you set there.

Typesense publishes nothing at all, so it takes no host port.

## Local development is one file, not two

[`docker-compose.search.yml`](../docker-compose.search.yml) at the repo root runs both services together on
56325 and 56326. There is no panel to satisfy on a laptop and you always want both, so one `up` is the right shape
there — the split exists for how the VPS deploys, not for how the stack works.
