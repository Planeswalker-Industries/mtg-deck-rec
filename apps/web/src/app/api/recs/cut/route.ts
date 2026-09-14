import { cutInputSchema } from "@mtg/core/schemas";
import { getCutSuggestions, MAX_CUT_LIMIT } from "@/lib/server/recs";
import { capLimit, handleRecsRequest } from "@/lib/server/recs-route";

export function POST(request: Request): Promise<Response> {
  return handleRecsRequest(
    request,
    cutInputSchema,
    (db, { context, limit }) => getCutSuggestions(db, { context, limit: capLimit(limit, MAX_CUT_LIMIT) }),
    "Couldn't load cut suggestions. Try again in a moment.",
  );
}
