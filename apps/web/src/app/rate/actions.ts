"use server";

import { headers } from "next/headers";
import type { ActionsApi, RaterDeal, Result } from "@mtg/core/contract";
import { dealRaterCardsInputSchema, parseInput } from "@mtg/core/schemas";
import { checkRateLimit, knownRateLimit } from "@/lib/server/rate-limit";
import { dealRaterCards } from "@/lib/server/rater";
import { NotFoundError } from "@/lib/server/recs";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/**
 * Deals cards for the card rater: what a commander's decks play, picked by card ids or by commander page slug. The
 * budget check goes out with the deal's reads, as on the recommendation routes (`handleRecsRequest`).
 */
export async function dealRaterCardsAction(input: Parameters<ActionsApi["dealRaterCards"]>[0]): Promise<Result<RaterDeal>> {
  const parsed = parseInput(dealRaterCardsInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const visitor = visitorKey(await headers());
    const known = knownRateLimit("recs", visitor);
    if (known) return { ok: false, error: known };
    const db = createPublicClient();
    const [limited, dealt] = await Promise.all([
      checkRateLimit(db, "recs", visitor),
      // Settled, so a request over budget answers RATE_LIMITED whatever happened to the deal.
      dealRaterCards(db, parsed.data).then(
        (data) => ({ data }),
        (err: unknown) => ({ err }),
      ),
    ]);
    if (limited) return { ok: false, error: limited };
    if ("err" in dealt) throw dealt.err;
    return { ok: true, data: dealt.data };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: { code: "NOT_FOUND", message: err.message } };
    console.error(err);
    return { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't deal cards to rate. Try again in a moment." } };
  }
}
