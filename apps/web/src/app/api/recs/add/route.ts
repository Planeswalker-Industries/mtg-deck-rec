import { addInputSchema } from "@mtg/core/schemas";
import { getAddSuggestions, MAX_ADD_PER_CATEGORY } from "@/lib/server/recs";
import { capLimit, handleRecsRequest } from "@/lib/server/recs-route";

export function POST(request: Request): Promise<Response> {
  return handleRecsRequest(
    request,
    addInputSchema,
    (db, { context, limitPerCategory }) =>
      getAddSuggestions(db, { context, limitPerCategory: capLimit(limitPerCategory, MAX_ADD_PER_CATEGORY) }),
    "Couldn't load suggestions. Try again in a moment.",
  );
}
