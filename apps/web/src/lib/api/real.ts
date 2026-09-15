import type { ActionsApi, ApiError, RecsApi, Result } from "@mtg/core/contract";
import { deleteCollectionAction, saveCollectionBatchAction } from "@/app/collection/actions";
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
  saveDeck: notYet,
  deleteDeck: notYet,
  exportDeck: notYet,
  castVote: (input) => castVoteAction(input),
  setFavorite: notYet,
  adminSetTagDisabled: notYet,
};
