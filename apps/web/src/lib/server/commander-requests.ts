import type { CommanderCoverage, CommanderRequest, CommanderRequestStatus } from "@mtg/core/contract";
import { fetchCardsById, toCardSummary } from "./cards";
import type { PublicClient } from "./supabase";

const STATUSES: readonly CommanderRequestStatus[] = [
  "queued",
  "checking",
  "collecting",
  "aggregating",
  "done",
  "not_enough_decks",
  "failed",
];
/** Used when app_config doesn't set the worker's pace. */
const DEFAULT_SECONDS_PER_DECK = 3.4;
const DEFAULT_AGGREGATE_SECONDS = 20;
const MIN_AGGREGATE_SECONDS_LEFT = 5;

const REFUSALS = ["RATE_LIMITED", "QUEUE_FULL", "NOT_A_COMMANDER"] as const;
export type CommanderRequestRefusal = (typeof REFUSALS)[number];

/** The database refused to start a lookup: too many from this visitor, a full queue, or a card that can't lead a deck. */
export class CommanderRequestRefused extends Error {
  constructor(readonly reason: CommanderRequestRefusal) {
    super(reason);
  }
}

interface RequestRow {
  id: string;
  commanderCardId: number;
  status: CommanderRequestStatus;
  decksTarget: number;
  decksListed: number | null;
  decksCollected: number;
  error: string | null;
  joined: boolean;
  updatedAt: string;
  queuePosition: number;
  decksAhead: number;
  secondsPerDeck: number;
  aggregateSeconds: number;
  collectorOnline: boolean;
}

const numberOr = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

function readRow(value: unknown): RequestRow {
  const v = (value ?? {}) as Record<string, unknown>;
  const status = STATUSES.find((s) => s === v.status);
  if (typeof v.id !== "string" || typeof v.commanderCardId !== "number" || !status || typeof v.updatedAt !== "string") {
    throw new Error("A commander request came back in an unexpected shape.");
  }
  return {
    id: v.id,
    commanderCardId: v.commanderCardId,
    status,
    decksTarget: numberOr(v.decksTarget, 100),
    decksListed: typeof v.decksListed === "number" ? v.decksListed : null,
    decksCollected: numberOr(v.decksCollected, 0),
    error: typeof v.error === "string" ? v.error : null,
    joined: v.joined === true,
    updatedAt: v.updatedAt,
    queuePosition: numberOr(v.queuePosition, 0),
    decksAhead: numberOr(v.decksAhead, 0),
    secondsPerDeck: numberOr(v.secondsPerDeck, DEFAULT_SECONDS_PER_DECK),
    aggregateSeconds: numberOr(v.aggregateSeconds, DEFAULT_AGGREGATE_SECONDS),
    collectorOnline: v.collectorOnline === true,
  };
}

/** Seconds until a lookup is done: decks still to collect at the worker's pace, plus a stats rebuild per lookup. */
export function lookupEtaSeconds(row: RequestRow, now = Date.now()): number | null {
  const { secondsPerDeck: perDeck, aggregateSeconds: rebuild } = row;
  switch (row.status) {
    case "queued":
      return Math.round((row.decksAhead + row.decksTarget) * perDeck + (row.queuePosition + 1) * rebuild);
    case "checking":
      return Math.round(row.decksTarget * perDeck + rebuild);
    case "collecting":
      return Math.round(Math.max(row.decksTarget - row.decksCollected, 0) * perDeck + rebuild);
    case "aggregating":
      return Math.max(Math.round(rebuild - (now - Date.parse(row.updatedAt)) / 1000), MIN_AGGREGATE_SECONDS_LEFT);
    default:
      return null;
  }
}

async function toRequest(db: PublicClient, row: RequestRow): Promise<CommanderRequest> {
  const card = (await fetchCardsById(db, [row.commanderCardId])).get(row.commanderCardId);
  if (!card) throw new Error(`Commander ${row.commanderCardId} is not in the catalog.`);
  return {
    id: row.id,
    commander: toCardSummary(card),
    status: row.status,
    decksListed: row.decksListed,
    decksCollected: row.decksCollected,
    decksTarget: row.decksTarget,
    queuePosition: row.queuePosition,
    etaSeconds: lookupEtaSeconds(row),
    joined: row.joined,
    collectorOnline: row.collectorOnline,
    error: row.error,
    updatedAt: row.updatedAt,
  };
}

function refusalOf(message: string): CommanderRequestRefusal | null {
  return REFUSALS.find((code) => message.includes(code)) ?? null;
}

/** The active or recently finished lookup for a commander, and how long a new one would take. Starts nothing. */
export async function getCommanderCoverage(db: PublicClient, commanderId: number, clientKey: string): Promise<CommanderCoverage> {
  const { data, error } = await db.rpc("get_commander_request", { p_card_id: commanderId, p_client_key: clientKey });
  if (error) throw new Error(`Loading the deck lookup for commander ${commanderId} failed: ${error.message}`);
  const v = (data ?? {}) as Record<string, unknown>;
  const perDeck = numberOr(v.secondsPerDeck, DEFAULT_SECONDS_PER_DECK);
  const rebuild = numberOr(v.aggregateSeconds, DEFAULT_AGGREGATE_SECONDS);
  return {
    request: v.request ? await toRequest(db, readRow(v.request)) : null,
    estimatedSeconds: Math.round(
      (numberOr(v.backlogDecks, 0) + numberOr(v.targetDecks, 100)) * perDeck + (numberOr(v.backlogRequests, 0) + 1) * rebuild,
    ),
    collectorOnline: v.collectorOnline === true,
  };
}

/** Starts a lookup or joins the active one. Throws CommanderRequestRefused when the database won't start one. */
export async function requestCommanderDecks(db: PublicClient, commanderId: number, clientKey: string): Promise<CommanderRequest> {
  const { data, error } = await db.rpc("request_commander_decks", { p_card_id: commanderId, p_client_key: clientKey });
  if (error) {
    const refusal = refusalOf(error.message);
    if (refusal) throw new CommanderRequestRefused(refusal);
    throw new Error(`Requesting decks for commander ${commanderId} failed: ${error.message}`);
  }
  return toRequest(db, readRow(data));
}

/** A lookup's current progress, or null when there's no lookup with that id. */
export async function getCommanderRequest(db: PublicClient, requestId: number, clientKey: string): Promise<CommanderRequest | null> {
  const { data, error } = await db.rpc("get_commander_request_status", { p_request_id: requestId, p_client_key: clientKey });
  if (error) throw new Error(`Loading deck lookup ${requestId} failed: ${error.message}`);
  return data ? toRequest(db, readRow(data)) : null;
}
