"use server";

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
  analyzeDeckInputSchema,
  commanderInputSchema,
  commanderRequestInputSchema,
  importDeckInputSchema,
  parseDeckInputSchema,
  parseInput,
} from "@mtg/core/schemas";
import {
  CommanderRequestRefused,
  getCommanderCoverage,
  getCommanderRequest,
  requestCommanderDecks,
  type CommanderRequestRefusal,
} from "@/lib/server/commander-requests";
import { analyzeDeckById, resolveDecklist } from "@/lib/server/deck";
import { checkRateLimit, type RateLimitBucket } from "@/lib/server/rate-limit";
import { createPublicClient, type PublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";

/** Identifies the app honestly on every outbound request (the worker sends the same). */
const USER_AGENT = "MTGDeckRec/0.1 (+https://github.com/wuddat/mtg-deck-rec)";
const IMPORT_TIMEOUT_MS = 10_000;

const failure = (code: ApiError["code"], message: string): Result<never> => ({ ok: false, error: { code, message } });

const unavailable = (err: unknown): Result<never> => {
  console.error(err);
  return failure("UPSTREAM_UNAVAILABLE", "Couldn't reach the card database. Try again in a moment.");
};

interface ActionScope {
  db: PublicClient;
  visitor: string;
  /** Set when the visitor's budget for this kind of action is spent. */
  limited: Result<never> | null;
}

/** A database client for one action call, the visitor's key, and whether they're over their request budget. */
async function begin(bucket: RateLimitBucket): Promise<ActionScope> {
  const db = createPublicClient();
  const visitor = visitorKey(await headers());
  const error = await checkRateLimit(db, bucket, visitor);
  return { db, visitor, limited: error ? { ok: false, error } : null };
}

export async function parseDeckAction(input: { text: string }): Promise<Result<ParseDeckResult>> {
  const parsed = parseInput(parseDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { db, limited } = await begin("deck");
    if (limited) return limited;
    return { ok: true, data: await resolveDecklist(db, parsed.data.text) };
  } catch (err) {
    return unavailable(err);
  }
}

/**
 * Imports a public Archidekt deck from its link: one request for that deck when the user asks, then the same parsing
 * and name resolution as pasted text. Moxfield doesn't allow automated access without its permission.
 */
export async function importDeckFromUrlAction(input: { url: string }): Promise<Result<ImportDeckUrlResult>> {
  const parsed = parseInput(importDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  const { url } = parsed.data;
  if (/^https?:\/\/(?:www\.)?moxfield\.com\//i.test(url)) {
    return failure(
      "UPSTREAM_NOT_AUTHORIZED",
      "Moxfield links can't be imported. In Moxfield, choose Export, copy the list, and paste it here.",
    );
  }
  const id = archidektDeckId(url);
  if (id === null) return failure("VALIDATION", "Paste a link to an Archidekt deck, like https://archidekt.com/decks/123456.");

  let scope: ActionScope;
  try {
    scope = await begin("import");
  } catch (err) {
    return unavailable(err);
  }
  if (scope.limited) return scope.limited;

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
    const resolved = await resolveDecklist(scope.db, decklist.text);
    return { ok: true, data: { ...resolved, source: "archidekt", sourceUrl: `https://archidekt.com/decks/${id}` } };
  } catch (err) {
    return unavailable(err);
  }
}

export async function analyzeDeckAction(input: { deck: DeckInput }): Promise<Result<DeckAnalysis>> {
  const parsed = parseInput(analyzeDeckInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { db, limited } = await begin("deck");
    if (limited) return limited;
    return { ok: true, data: await analyzeDeckById(db, parsed.data.deck) };
  } catch (err) {
    return unavailable(err);
  }
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

const refusalMessages: Record<CommanderRequestRefusal, Result<never>> = {
  RATE_LIMITED: failure("RATE_LIMITED", "You've started several deck lookups in the last hour. Try again later."),
  QUEUE_FULL: failure("RATE_LIMITED", "Lots of deck lookups are waiting right now. Try again in a few minutes."),
  NOT_A_COMMANDER: failure("VALIDATION", "That card can't lead a Commander deck."),
};

export async function getCommanderCoverageAction(input: { commanderId: number }): Promise<Result<CommanderCoverage>> {
  const parsed = parseInput(commanderInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { db, visitor, limited } = await begin("lookup");
    if (limited) return limited;
    const coverage = await getCommanderCoverage(db, parsed.data.commanderId, visitor);
    refreshCachesAfter(coverage.request);
    return { ok: true, data: coverage };
  } catch (err) {
    return unavailable(err);
  }
}

export async function requestCommanderDecksAction(input: { commanderId: number }): Promise<Result<CommanderRequest>> {
  const parsed = parseInput(commanderInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { db, visitor, limited } = await begin("lookup");
    if (limited) return limited;
    const request = await requestCommanderDecks(db, parsed.data.commanderId, visitor);
    refreshCachesAfter(request);
    return { ok: true, data: request };
  } catch (err) {
    if (err instanceof CommanderRequestRefused) return refusalMessages[err.reason];
    return unavailable(err);
  }
}

export async function getCommanderRequestAction(input: { requestId: string }): Promise<Result<CommanderRequest>> {
  const parsed = parseInput(commanderRequestInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { db, visitor, limited } = await begin("lookup");
    if (limited) return limited;
    const request = await getCommanderRequest(db, Number(parsed.data.requestId), visitor);
    if (!request) return failure("NOT_FOUND", "That deck lookup doesn't exist.");
    refreshCachesAfter(request);
    return { ok: true, data: request };
  } catch (err) {
    return unavailable(err);
  }
}
