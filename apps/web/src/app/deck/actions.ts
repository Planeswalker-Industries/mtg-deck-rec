"use server";

import { updateTag } from "next/cache";
import { headers } from "next/headers";
import type {
  ActionsApi,
  ApiError,
  CollectionRowInput,
  CommanderCoverage,
  CommanderRequest,
  DeckAnalysis,
  DeckInput,
  ImportDeckUrlResult,
  ParseDeckResult,
  ResolveCollectionResult,
  Result,
  VoteSummary,
} from "@mtg/core/contract";
import { archidektDeckId, archidektDecklist } from "@mtg/core/parse";
import {
  analyzeDeckInputSchema,
  castVoteInputSchema,
  commanderInputSchema,
  commanderRequestInputSchema,
  importDeckInputSchema,
  parseDeckInputSchema,
  parseInput,
  resolveCollectionRowsInputSchema,
} from "@mtg/core/schemas";
import {
  CommanderRequestRefused,
  getCommanderCoverage,
  getCommanderRequest,
  requestCommanderDecks,
  type CommanderRequestRefusal,
} from "@/lib/server/commander-requests";
import { resolveCollectionRows } from "@/lib/server/collections";
import { analyzeDeckById, resolveDecklist } from "@/lib/server/deck";
import { fetchShareLink } from "@/lib/server/share-import";
import { checkRateLimit, type RateLimitBucket } from "@/lib/server/rate-limit";
import { createAuthClient } from "@/lib/server/auth";
import { createPublicClient, type PublicClient } from "@/lib/server/supabase";
import { visitorKey } from "@/lib/server/visitor";
import { castSwapVote, VoteRefused, type VoteRefusal } from "@/lib/server/votes";

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
    const fetched = await fetchShareLink(scope.db, { source: "archidekt", url: `https://archidekt.com/api/decks/${id}/`, expects: "json", what: "deck" });
    if (!fetched.ok) return { ok: false, error: fetched.error };
    body = JSON.parse(fetched.body);
  } catch (err) {
    console.error(err);
    return failure("UPSTREAM_UNAVAILABLE", "Couldn't load that Archidekt deck. Try again in a moment.");
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

/** Matches up to 2,000 exported collection rows to printings and cards. Works without an account. */
export async function resolveCollectionRowsAction(input: { rows: CollectionRowInput[] }): Promise<Result<ResolveCollectionResult>> {
  const parsed = parseInput(resolveCollectionRowsInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const { db, limited } = await begin("collection");
    if (limited) return limited;
    return { ok: true, data: await resolveCollectionRows(db, parsed.data.rows) };
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

const voteRefusals: Record<VoteRefusal, Result<never>> = {
  VOTER_REQUIRED: failure("VALIDATION", "Couldn't tell who's voting. Reload the page and try again."),
  INVALID_VOTE: failure("VALIDATION", "That vote isn't valid."),
  UNKNOWN_CARD: failure("NOT_FOUND", "One of those cards isn't in the catalog anymore."),
};

/**
 * Records a swipe vote: whether the replacement is a good swap for the target. Works signed out; the session client goes
 * along so the database can key a signed-in vote to the account.
 */
export async function castVoteAction(input: Parameters<ActionsApi["castVote"]>[0]): Promise<Result<VoteSummary>> {
  const parsed = parseInput(castVoteInputSchema, input);
  if (!parsed.ok) return parsed;
  try {
    const db = await createAuthClient();
    const visitor = visitorKey(await headers());
    const limited = await checkRateLimit(db, "vote", visitor);
    if (limited) return { ok: false, error: limited };
    return { ok: true, data: await castSwapVote(db, parsed.data, visitor) };
  } catch (err) {
    if (err instanceof VoteRefused) return voteRefusals[err.reason];
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
