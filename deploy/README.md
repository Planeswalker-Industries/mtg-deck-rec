# deploy

The search stack on the VPS, as **two independently deployed compose files**.

| Directory | What it runs | Faces the internet |
|---|---|---|
| [`typesense/`](typesense/) | Typesense | No — publishes no port at all |
| [`search-api/`](search-api/) | [`services/search-api`](../services/search-api) | Yes, behind a reverse proxy with TLS |

Two files rather than one because a managed panel treats one compose file as one application, and the two have
different lifecycles: the API is rebuilt whenever its Go code changes, while Typesense is a long-lived stateful
container you only touch to upgrade it.

## They meet on a network you create once

```sh
docker network create mtg-search
```

Both stacks declare it `external`, so neither depends on the other's deploy order and a missing network fails `up`
loudly instead of quietly starting a container that cannot reach the index. The Typesense service publishes the
alias `typesense` on it, which is the whole of `TYPESENSE_URL=http://typesense:8108` in the API's environment.

**Order does not matter.** Measured: stop the Typesense stack and the API keeps running and stays *healthy* — its
container probe asks liveness, not readiness — while `/v1/health` honestly returns 503 and the web app falls back to
Postgres. Start Typesense again and it recovers on its own, with nothing to restart.

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
docker network create mtg-search

cd deploy/typesense  && cp .env.example .env && $EDITOR .env && docker compose up -d
cd ../search-api     && cp .env.example .env && $EDITOR .env && docker compose up -d --build

curl http://127.0.0.1:8090/v1/health          # {"ok":true} — the stack works
curl https://<host>/v1/health                 # {"ok":true} — and the proxy routes to it
```

Then build the index, and point Vercel and the sync workflow at it. Both steps are in
[`docs/roadmap/typesense-ops.md`](../docs/roadmap/typesense-ops.md), which is the runbook this summarises.

## Local development is one file, not two

[`docker-compose.search.yml`](../docker-compose.search.yml) at the repo root runs both services together on
56325 and 56326. There is no panel to satisfy on a laptop and you always want both, so one `up` is the right shape
there — the split exists for how the VPS deploys, not for how the stack works.
