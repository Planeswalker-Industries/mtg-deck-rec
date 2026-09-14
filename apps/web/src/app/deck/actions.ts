"use server";

import type { DeckAnalysis, DeckInput, ParseDeckResult, Result } from "@mtg/core/contract";
import { analyzeDeckById, resolveDecklist } from "@/lib/server/deck";
import { createPublicClient } from "@/lib/server/supabase";

const MAX_DECKLIST_CHARS = 20_000;
const MAX_DECK_ENTRIES = 400;

const unavailable = (err: unknown): Result<never> => {
  console.error(err);
  return {
    ok: false,
    error: { code: "UPSTREAM_UNAVAILABLE", message: "Couldn't reach the card database. Try again in a moment." },
  };
};

export async function parseDeckAction(input: { text: string }): Promise<Result<ParseDeckResult>> {
  if (typeof input?.text !== "string") {
    return { ok: false, error: { code: "VALIDATION", message: "Send the decklist as text." } };
  }
  if (input.text.length > MAX_DECKLIST_CHARS) {
    return { ok: false, error: { code: "PAYLOAD_TOO_LARGE", message: "Decklists can be at most 20,000 characters." } };
  }
  try {
    return { ok: true, data: await resolveDecklist(createPublicClient(), input.text) };
  } catch (err) {
    return unavailable(err);
  }
}

export async function analyzeDeckAction(input: { deck: DeckInput }): Promise<Result<DeckAnalysis>> {
  const deck = input?.deck;
  const ids = deck ? [...deck.commanders, ...deck.cards.map((c) => c.cardId)] : [];
  if (!deck || ids.length > MAX_DECK_ENTRIES || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return { ok: false, error: { code: "VALIDATION", message: "That deck isn't valid." } };
  }
  try {
    return { ok: true, data: await analyzeDeckById(createPublicClient(), deck) };
  } catch (err) {
    return unavailable(err);
  }
}
