"use server";

import type { ApiError, DeckAnalysis, DeckInput, ImportDeckUrlResult, ParseDeckResult, Result } from "@mtg/core/contract";
import { archidektDeckId, archidektDecklist } from "@mtg/core/parse";
import { analyzeDeckById, resolveDecklist } from "@/lib/server/deck";
import { createPublicClient } from "@/lib/server/supabase";

const MAX_DECKLIST_CHARS = 20_000;
const MAX_DECK_ENTRIES = 400;
/** Identifies the app honestly on every outbound request (the worker sends the same). */
const USER_AGENT = "MTGDeckRec/0.1 (+https://github.com/wuddat/mtg-deck-rec)";
const IMPORT_TIMEOUT_MS = 10_000;

const failure = (code: ApiError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

const unavailable = (err: unknown): Result<never> => {
  console.error(err);
  return failure("UPSTREAM_UNAVAILABLE", "Couldn't reach the card database. Try again in a moment.");
};

export async function parseDeckAction(input: { text: string }): Promise<Result<ParseDeckResult>> {
  if (typeof input?.text !== "string") {
    return failure("VALIDATION", "Send the decklist as text.");
  }
  if (input.text.length > MAX_DECKLIST_CHARS) {
    return failure("PAYLOAD_TOO_LARGE", "Decklists can be at most 20,000 characters.");
  }
  try {
    return { ok: true, data: await resolveDecklist(createPublicClient(), input.text) };
  } catch (err) {
    return unavailable(err);
  }
}

/**
 * Imports a public Archidekt deck from its link: one request for that deck when the user asks, then the same parsing
 * and name resolution as pasted text. Moxfield doesn't allow automated access without its permission.
 */
export async function importDeckFromUrlAction(input: { url: string }): Promise<Result<ImportDeckUrlResult>> {
  const url = typeof input?.url === "string" ? input.url.trim() : "";
  if (/^https?:\/\/(?:www\.)?moxfield\.com\//i.test(url)) {
    return failure(
      "UPSTREAM_NOT_AUTHORIZED",
      "Moxfield links can't be imported. In Moxfield, choose Export, copy the list, and paste it here.",
    );
  }
  const id = archidektDeckId(url);
  if (id === null) return failure("VALIDATION", "Paste a link to an Archidekt deck, like https://archidekt.com/decks/123456.");

  let body: unknown;
  try {
    const res = await fetch(`https://archidekt.com/api/decks/${id}/`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 403 || res.status === 404) return failure("NOT_FOUND", "That Archidekt deck doesn't exist or isn't public.");
    if (res.status === 429) return failure("RATE_LIMITED", "Archidekt is busy right now. Wait a minute and try the link again.");
    if (!res.ok) return failure("UPSTREAM_UNAVAILABLE", "Couldn't reach Archidekt. Try again in a moment.");
    body = await res.json();
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", "Couldn't reach Archidekt. Try again in a moment.");
  }

  const decklist = archidektDecklist(body);
  if (!decklist) return failure("UPSTREAM_UNAVAILABLE", "Archidekt didn't send a deck we could read. Paste the decklist instead.");
  try {
    const parsed = await resolveDecklist(createPublicClient(), decklist.text);
    return { ok: true, data: { ...parsed, source: "archidekt", sourceUrl: `https://archidekt.com/decks/${id}` } };
  } catch (err) {
    return unavailable(err);
  }
}

export async function analyzeDeckAction(input: { deck: DeckInput }): Promise<Result<DeckAnalysis>> {
  const deck = input?.deck;
  const ids = deck ? [...deck.commanders, ...deck.cards.map((c) => c.cardId)] : [];
  if (!deck || ids.length > MAX_DECK_ENTRIES || !ids.every((id) => Number.isInteger(id) && id > 0)) {
    return failure("VALIDATION", "That deck isn't valid.");
  }
  try {
    return { ok: true, data: await analyzeDeckById(createPublicClient(), deck) };
  } catch (err) {
    return unavailable(err);
  }
}
