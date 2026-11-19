import type { ActionsApi, CardSummary, CatalogApi, RecsApi, Result } from "@mtg/core/contract";
import { callAction, offline } from "./call-action";
import {
  deleteCollectionAction,
  getMyCollectionEntriesAction,
  getMyCollectionSharingAction,
  getSharedCollectionAction,
  saveCollectionBatchAction,
  setCollectionCardQuantityAction,
  setCollectionSharingAction,
} from "@/app/collection/actions";
import { submitFeedbackAction } from "@/app/feedback/actions";
import { dealRaterCardsAction } from "@/app/rate/actions";
import {
  analyzeDeckAction,
  castVoteAction,
  recordRecEventAction,
  getCommanderCoverageAction,
  getDeckCoverageAction,
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
  setDeckBuiltAction,
  setDeckVisibilityAction,
} from "@/app/decks/actions";

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
  fix: (input) => post("/api/recs/fix", input),
  cut: (input) => post("/api/recs/cut", input),
  build: (input) => post("/api/recs/build", input),
};

export const realActions: ActionsApi = {
  parseDeck: (input) => callAction(() => parseDeckAction(input)),
  analyzeDeck: (input) => callAction(() => analyzeDeckAction(input)),
  getDeckCoverage: (input) => callAction(() => getDeckCoverageAction(input)),
  importDeckFromUrl: (input) => callAction(() => importDeckFromUrlAction(input)),
  getCommanderCoverage: (input) => callAction(() => getCommanderCoverageAction(input)),
  requestCommanderDecks: (input) => callAction(() => requestCommanderDecksAction(input)),
  getCommanderRequest: (input) => callAction(() => getCommanderRequestAction(input)),
  resolveCollectionRows: (input) => callAction(() => resolveCollectionRowsAction(input)),
  saveCollectionBatch: (input) => callAction(() => saveCollectionBatchAction(input)),
  deleteCollection: () => callAction(() => deleteCollectionAction()),
  getMyCollectionEntries: () => callAction(() => getMyCollectionEntriesAction()),
  setCollectionCardQuantity: (input) => callAction(() => setCollectionCardQuantityAction(input)),
  getMyCollectionSharing: () => callAction(() => getMyCollectionSharingAction()),
  setCollectionSharing: (input) => callAction(() => setCollectionSharingAction(input)),
  getSharedCollection: (input) => callAction(() => getSharedCollectionAction(input)),
  saveDeck: (input) => callAction(() => saveDeckAction(input)),
  openSavedDeck: (input) => callAction(() => openSavedDeckAction(input)),
  renameDeck: (input) => callAction(() => renameDeckAction(input)),
  duplicateDeck: (input) => callAction(() => duplicateDeckAction(input)),
  setDeckVisibility: (input) => callAction(() => setDeckVisibilityAction(input)),
  setDeckBuilt: (input) => callAction(() => setDeckBuiltAction(input)),
  deleteDeck: (input) => callAction(() => deleteDeckAction(input)),
  exportDeck: notYet,
  castVote: (input) => callAction(() => castVoteAction(input)),
  recordRecEvent: (input) => callAction(() => recordRecEventAction(input)),
  setFavorite: notYet,
  adminSetTagDisabled: notYet,
  dealRaterCards: (input) => callAction(() => dealRaterCardsAction(input)),
  submitFeedback: (input) => callAction(() => submitFeedbackAction(input)),
};

/** Card lookups run as GET Route Handlers, so the CDN can keep results and searches don't queue behind actions. */
export const realCatalog: CatalogApi = {
  async searchCards(input, options) {
    const { q, commanderEligible, limit, colorIdentity, cardTypes, manaValues, offset, sort, ownedOnly } = input;
    const params = new URLSearchParams({ q });
    if (commanderEligible) params.set("commander", "1");
    if (limit !== undefined) params.set("limit", String(limit));
    if (colorIdentity !== undefined) params.set("colors", colorIdentity);
    // Sorted, so the same filters in a different click order are the same URL and share the CDN's cached answer.
    if (cardTypes?.length) params.set("type", [...cardTypes].sort().join(","));
    if (manaValues?.length) params.set("mv", [...manaValues].sort((a, b) => a - b).join(","));
    if (offset !== undefined) params.set("offset", String(offset));
    if (sort !== undefined) params.set("sort", sort);
    const signal = options?.signal ? { signal: options.signal } : {};
    try {
      // A search limited to a collection is private and can carry thousands of card ids, so it goes as a POST body.
      const res =
        ownedOnly === undefined
          ? await fetch(`/api/cards/search?${params.toString()}`, signal)
          : await fetch("/api/cards/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input),
              ...signal,
            });
      // Which backend answered, in the console, because the alternative is reading server logs. `x-vercel-cache: HIT`
      // means the edge answered and no function ran, so the source is whatever was true when that entry was cached —
      // add `&fresh=1` to bypass it.
      console.info(
        `[search] ${res.headers.get("x-search-source") ?? "unknown"}` + ` (cache: ${res.headers.get("x-vercel-cache") ?? "none"})`,
      );
      return (await res.json()) as Result<CardSummary[]>;
    } catch {
      // An abort lands here too. The caller asked for this one to stop, and its own request counter discards the
      // answer, so there is nothing to tell apart: a search it no longer wants cannot be an error it has to show.
      return { ok: false, error: offline };
    }
  },

  // POST, not GET: a hundred card ids do not belong in a URL. The answer is the same for everyone, so the
  // route still sets cache headers.
  cardTags: (input) => post("/api/cards/tags", input),
  cardRules: (input) => post("/api/cards/rules", input),
  collectionCards: (input) => post("/api/cards/collection", input),
};
