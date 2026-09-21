import type { ActionsApi, ApiError, CardSummary, CatalogApi, RecsApi, Result } from "@mtg/core/contract";
import { deleteCollectionAction, getMyCollectionEntriesAction, saveCollectionBatchAction } from "@/app/collection/actions";
import { dealRaterCardsAction } from "@/app/rate/actions";
import {
  analyzeDeckAction,
  castVoteAction,
  getCommanderCoverageAction,
  getCommanderRequestAction,
  importDeckFromUrlAction,
  parseDeckAction,
  requestCommanderDecksAction,
  resolveCollectionRowsAction,
} from "@/app/deck/actions";
import {
  deleteDeckAction,
  duplicateDeckAction,
  openSavedDeckAction,
  renameDeckAction,
  saveDeckAction,
  setDeckVisibilityAction,
} from "@/app/decks/actions";

const offline: ApiError = {
  code: "UPSTREAM_UNAVAILABLE",
  message: "Couldn't reach the server. Check your connection and try again.",
};

async function post<T>(path: string, body: unknown): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as Result<T>;
  } catch {
    return { ok: false, error: offline };
  }
}

const notYet = async (): Promise<Result<never>> => ({
  ok: false,
  error: { code: "INTERNAL", message: "This isn't available yet." },
});

/** Recommendations run as Route Handlers so add, cut and swap requests can load in parallel. */
export const realRecs: RecsApi = {
  swap: (input) => post("/api/recs/swap", input),
  add: (input) => post("/api/recs/add", input),
  cut: (input) => post("/api/recs/cut", input),
};

export const realActions: ActionsApi = {
  parseDeck: (input) => parseDeckAction(input),
  analyzeDeck: (input) => analyzeDeckAction(input),
  importDeckFromUrl: (input) => importDeckFromUrlAction(input),
  getCommanderCoverage: (input) => getCommanderCoverageAction(input),
  requestCommanderDecks: (input) => requestCommanderDecksAction(input),
  getCommanderRequest: (input) => getCommanderRequestAction(input),
  resolveCollectionRows: (input) => resolveCollectionRowsAction(input),
  saveCollectionBatch: (input) => saveCollectionBatchAction(input),
  deleteCollection: () => deleteCollectionAction(),
  getMyCollectionEntries: () => getMyCollectionEntriesAction(),
  saveDeck: (input) => saveDeckAction(input),
  openSavedDeck: (input) => openSavedDeckAction(input),
  renameDeck: (input) => renameDeckAction(input),
  duplicateDeck: (input) => duplicateDeckAction(input),
  setDeckVisibility: (input) => setDeckVisibilityAction(input),
  deleteDeck: (input) => deleteDeckAction(input),
  exportDeck: notYet,
  castVote: (input) => castVoteAction(input),
  setFavorite: notYet,
  adminSetTagDisabled: notYet,
  dealRaterCards: (input) => dealRaterCardsAction(input),
};

/** Card lookups run as GET Route Handlers, so the CDN can keep results and searches don't queue behind actions. */
export const realCatalog: CatalogApi = {
  async searchCards({ q, commanderEligible, limit }) {
    const params = new URLSearchParams({ q });
    if (commanderEligible) params.set("commander", "1");
    if (limit !== undefined) params.set("limit", String(limit));
    try {
      const res = await fetch(`/api/cards/search?${params.toString()}`);
      return (await res.json()) as Result<CardSummary[]>;
    } catch {
      return { ok: false, error: offline };
    }
  },

  // POST, not GET: a hundred card ids do not belong in a URL. The answer is the same for everyone, so the
  // route still sets cache headers.
  cardTags: (input) => post("/api/cards/tags", input),
  collectionCards: (input) => post("/api/cards/collection", input),
};
