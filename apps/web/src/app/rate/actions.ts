"use server";

import { headers } from "next/headers";
import type { ActionsApi, RaterDeal, Result } from "@mtg/core/contract";
import { dealRaterCardsInputSchema, parseInput } from "@mtg/core/schemas";
import { checkRateLimit } from "@/lib/server/rate-limit";
import { dealRaterCards } from "@/lib/server/rater";
import { NotFoundError } from "@/lib/server/recs";
import { createPublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/** Deals cards for the card rater: what a commander's decks play, picked by card ids or by commander page slug. */
export async function dealRaterCardsAction(input: Parameters<ActionsApi["dealRaterCards"]>[0]): Promise<Result<RaterDeal>> {
  const parsed = parseInput(dealRaterCardsInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const db = createPublicClient();
    const limited = await checkRateLimit(db, "recs", visitorKey(await headers()));
    if (limited) return { ok: false, error: limited };
    return { ok: true, data: await dealRaterCards(db, parsed.data) };
  } catch (err) {
    if (err instanceof NotFoundError) return { ok: false, error: { code: "NOT_FOUND", message: err.message } };
    console.error(err);
    return { ok: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't deal cards to rate. Try again in a moment." } };
  }
}
