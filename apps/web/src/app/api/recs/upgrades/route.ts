import { MAX_UPGRADES_LIMIT, upgradesInputSchema } from "@mtg/core/schemas";
import { capLimit, handleRecsRequest } from "@/lib/server/recs-route";
import { getUpgrades } from "@/lib/server/upgrades";

export function POST(request: Request): Promise<Response> {
  return handleRecsRequest(
    request,
    upgradesInputSchema,
    (db, { context, limit }, collection) => getUpgrades(db, { context, collection, limit: capLimit(limit, MAX_UPGRADES_LIMIT) }),
    "Couldn't load upgrades. Try again in a moment.",
  );
}
