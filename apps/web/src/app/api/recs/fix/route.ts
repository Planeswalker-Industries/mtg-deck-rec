import { fixInputSchema } from "@mtg/core/schemas";
import { getFix } from "@/lib/server/recs";
import { handleRecsRequest } from "@/lib/server/recs-route";

export function POST(request: Request): Promise<Response> {
  return handleRecsRequest(
    request,
    fixInputSchema,
    (db, { context }, collection) => getFix(db, { context, collection }),
    "Couldn't load fixes. Try again in a moment.",
    "fix",
  );
}
