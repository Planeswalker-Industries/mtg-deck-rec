# The worker (apps/worker) for the VPS: one long-running `cli serve` that serves deck lookups through the crawl,
# starts the daily crawl, collates the raw sources, rebuilds the corpus stats and fetches EDHREC, on the
# app_config.worker schedule (T066). Built from the repo root, because the worker imports @mtg/core from its
# workspace: `docker build -f apps/worker/Dockerfile .`
FROM node:24-slim
WORKDIR /app
RUN corepack enable

# Manifests first, so a code change does not reinstall dependencies. Every workspace's manifest is needed for Yarn to
# resolve the project; only the worker's dependencies are installed.
COPY package.json yarn.lock .yarnrc.yml ./
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
RUN yarn workspaces focus @mtg/worker

COPY packages/core packages/core
COPY apps/worker apps/worker

USER node
# tsx runs the TypeScript directly, as `yarn workspace @mtg/worker cli` does everywhere else, without needing Yarn (or
# a download of it) at run time. Any other command runs the same way: `docker compose run --rm worker <command>`.
ENTRYPOINT ["/app/node_modules/.bin/tsx", "apps/worker/src/cli.ts"]
CMD ["serve"]
