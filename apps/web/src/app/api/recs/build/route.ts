import { buildInputSchema } from "@mtg/core/schemas";
import { getBuild } from "@/lib/server/recs";
import { handleRecsRequest } from "@/lib/server/recs-route";

export function POST(request: Request): Promise<Response> {
  return handleRecsRequest(
    request,
    buildInputSchema,
    (db, { context, fill }, collection) => getBuild(db, { context, collection, fill }),
    "Couldn't build the deck. Try again in a moment.",
  );
}
