"use server";

import { createHash } from "node:crypto";
import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type {
  ApiError,
  CommanderCoverage,
  CommanderRequest,
  DeckAnalysis,
  DeckInput,
  ImportDeckUrlResult,
  ParseDeckResult,
  Result,
} from "@mtg/core/contract";
import { archidektDeckId, archidektDecklist } from "@mtg/core/parse";
import {
  CommanderRequestRefused,
  getCommanderCoverage,
  getCommanderRequest,
  requestCommanderDecks,
  type CommanderRequestRefusal,
} from "@/lib/server/commander-requests";
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

/**
 * Identifies a visitor for deck lookup rate limits without storing their address: a salted hash of the first
 * forwarded address (set by the hosting proxy).
 */
async function visitorKey(): Promise<string> {
  const salt = process.env.RATE_LIMIT_SALT;
  if (!salt && process.env.NODE_ENV === "production") throw new Error("RATE_LIMIT_SALT is not set.");
  const h = await headers();
  const address = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${salt ?? "development"}:${address}`).digest("base64url");
}

/** Lookups this server instance has already refreshed cached pages and swap data for. */
const refreshedLookups = new Set<string>();

/** A finished lookup rebuilt the play-rate stats, so cached commander and card pages and swap pools are out of date. */
function refreshCachesAfter(request: CommanderRequest | null) {
  if (request?.status !== "done" || refreshedLookups.has(request.id)) return;
  refreshedLookups.add(request.id);
  updateTag("corpus");
  updateTag("recs");
}

const isCardId = (id: unknown): id is number => typeof id === "number" && Number.isInteger(id) && id > 0;

const refusalMessages: Record<CommanderRequestRefusal, Result<never>> = {
  RATE_LIMITED: failure("RATE_LIMITED", "You've started several deck lookups in the last hour. Try again later."),
  QUEUE_FULL: failure("RATE_LIMITED", "Lots of deck lookups are waiting right now. Try again in a few minutes."),
  NOT_A_COMMANDER: failure("VALIDATION", "That card can't lead a Commander deck."),
};

export async function getCommanderCoverageAction(input: { commanderId: number }): Promise<Result<CommanderCoverage>> {
  if (!isCardId(input?.commanderId)) return failure("VALIDATION", "That commander isn't valid.");
  try {
    const coverage = await getCommanderCoverage(createPublicClient(), input.commanderId, await visitorKey());
    refreshCachesAfter(coverage.request);
    return { ok: true, data: coverage };
  } catch (err) {
    return unavailable(err);
  }
}

export async function requestCommanderDecksAction(input: { commanderId: number }): Promise<Result<CommanderRequest>> {
  if (!isCardId(input?.commanderId)) return failure("VALIDATION", "That commander isn't valid.");
  try {
    const request = await requestCommanderDecks(createPublicClient(), input.commanderId, await visitorKey());
    refreshCachesAfter(request);
    return { ok: true, data: request };
  } catch (err) {
    if (err instanceof CommanderRequestRefused) return refusalMessages[err.reason];
    return unavailable(err);
  }
}

export async function getCommanderRequestAction(input: { requestId: string }): Promise<Result<CommanderRequest>> {
  const requestId = typeof input?.requestId === "string" && /^\d{1,15}$/.test(input.requestId) ? Number(input.requestId) : null;
  if (requestId === null) return failure("VALIDATION", "That deck lookup isn't valid.");
  try {
    const request = await getCommanderRequest(createPublicClient(), requestId, await visitorKey());
    if (!request) return failure("NOT_FOUND", "That deck lookup doesn't exist.");
    refreshCachesAfter(request);
    return { ok: true, data: request };
  } catch (err) {
    return unavailable(err);
  }
}
