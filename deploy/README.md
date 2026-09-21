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

## Three secrets, each able to do less than the last

| Secret | Held by | Can |
|---|---|---|
| `TYPESENSE_ADMIN_KEY` | both stacks, never leaves the VPS | everything Typesense can do |
| `SEARCH_API_ADMIN_TOKEN` | the worker and the sync workflow | read and write the index |
| `SEARCH_API_TOKEN` | Vercel | read only |

`TYPESENSE_ADMIN_KEY` is the one duplicated value: it appears in both `.env` files, because Typesense is told to use
it and the API is told to present it. Changing it means changing it in both places and restarting both. The API
refuses to start if the two tokens match, or if any of the three is empty.

## Order to stand it up

```sh
cd deploy/typesense  && cp .env.example .env && $EDITOR .env && docker compose up -d   # creates the network
cd ../search-api     && cp .env.example .env && $EDITOR .env && docker compose up -d --build

curl http://127.0.0.1:8090/v1/health          # {"ok":true} — the stack works
curl https://<host>/v1/health                 # {"ok":true} — and the proxy routes to it
```

Then build the index, and point Vercel and the sync workflow at it. Both steps are in
[`docs/roadmap/typesense-ops.md`](../docs/roadmap/typesense-ops.md), which is the runbook this summarises.

## On Dokploy (or any panel that deploys one compose file per app)

Dokploy runs each compose file as its own project — `docker compose -p <app> -f deploy/search-api/docker-compose.yml
up -d --build` — and runs Traefik under Swarm. Three things follow, and getting any of them wrong produces a deploy
error rather than a subtle bug.

**1. Use Dokploy's own network, not one of ours.** Dokploy maintains a shared network every app can join, so neither
stack needs to create anything and the deploy order stops mattering. Find its name:

```sh
docker network ls | grep dokploy      # usually `dokploy-network`
```

Then set these in **both** apps' environment, in the panel:

```
SEARCH_NETWORK=dokploy-network
SEARCH_NETWORK_EXTERNAL=true
```

Without them, the API app fails with `Could not attach to network mtg-search: network mtg-search not found`,
because the network is ours and the Typesense app is what creates it — so the API app deployed on its own has
nothing to attach to.

**2. Routing — one of two ways, and it is worth knowing which your panel wants.** Either way the domain goes on the
**search-api** app and Typesense gets none at all; it is not supposed to be reachable.

*Let the panel do it.* Add the domain in the panel's UI against the search-api service, container port **8080** (or
whatever `SEARCH_API_CONTAINER_PORT` is set to), and leave `TRAEFIK_ENABLE` unset here.

*Or do it with these labels.* If the panel's domain does not take — this file ships `traefik.enable=false` by
default, and a panel that merges rather than replaces labels may leave that winning — switch ours on instead:

```
TRAEFIK_ENABLE=true
TRAEFIK_EXTERNAL=true
TRAEFIK_NETWORK=dokploy-network
SEARCH_API_HOST=<the hostname>
TRAEFIK_CERT_RESOLVER=<whatever the panel's Traefik calls its resolver>
```

The symptom that tells you which you are in: a `404 page not found` from Traefik with a `CN=TRAEFIK DEFAULT CERT`
means **no router matched the hostname** — one problem, not two, because Traefik only requests a certificate for a
hostname it has a router for. Check the router before suspecting Let's Encrypt.

**3. Keep the index out of the clone.** Dokploy clones the repo per app, so the default `./data` bind mount lands
inside a directory a redeploy may replace. Set `TYPESENSE_DATA_DIR` on the Typesense app to an absolute path outside
it:

```
TYPESENSE_DATA_DIR=/var/lib/mtg-typesense
```

Nothing is lost that `sync:typesense --rebuild` cannot recreate, but a redeploy that silently empties the index is a
slow surprise.

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
