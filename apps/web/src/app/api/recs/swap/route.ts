import { swapInputSchema } from "@mtg/core/schemas";
import { MAX_SWAP_LIMIT } from "@/lib/server/recs";
import { getCachedSwapSuggestions } from "@/lib/server/recs-cache";
import { capLimit, handleRecsRequest } from "@/lib/server/recs-route";

export function POST(request: Request): Promise<Response> {
  return handleRecsRequest(
    request,
    swapInputSchema,
    (db, { context, targetCardId, limit }) =>
      getCachedSwapSuggestions(db, { context, targetCardId, limit: capLimit(limit, MAX_SWAP_LIMIT) }),
    "Couldn't load replacements. Try again in a moment.",
  );
}
