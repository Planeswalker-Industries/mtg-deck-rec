"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Bracket,
  CardId,
  CutResult,
  DeckAnalysis,
  DeckId,
  DeckInput,
  ImportDeckUrlResult,
  OwnershipInput,
  OwnershipMode,
  ParseDeckResult,
  RecContext,
  ResolvedLine,
  Result,
  SavedDeckContents,
  SwapResult,
} from "@mtg/core/contract";
import { deckDiff } from "@mtg/core/journey";
import { mockDecklistText } from "@mtg/core/mocks";
import type { CollectionSource } from "@/components/collection/use-collection-source";
import { getApis } from "@/lib/api/client";
import { ownedCardIds } from "@/lib/collection-store";
import { defaultIncludeGameChangers } from "@/lib/labels";
import { clearSavedDeck, loadSavedDeck, saveDeck, updateSavedDeck, type SavedDeck } from "@/lib/saved-deck";
import { SAMPLE_DECKLIST } from "@/lib/sample-deck";

/** Mock mode's card pool only covers the mock sample, so real data gets a sample with play-rate data behind it. */
const sampleDecklist = process.env.NEXT_PUBLIC_USE_MOCKS === "1" ? mockDecklistText : SAMPLE_DECKLIST;

export type Async<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

export interface SwapState {
  targetCardId: CardId;
  result: Async<SwapResult>;
}

const toAsync = <T>(r: Result<T>): Async<T> =>
  r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.error.message };

/** A lone link in the decklist box is imported instead of parsed. */
const DECK_LINK = /^https?:\/\/\S+$/i;

export interface ImportedFrom {
  source: ImportDeckUrlResult["source"];
  url: string;
}

/** What a submit produced: whether the decklist parsed, and the analysis when every line resolved. */
export interface SubmitOutcome {
  parsed: boolean;
  analysis: DeckAnalysis | null;
}

/**
 * How a submit goes. `keepOrigin` marks a result the tool produced (a journey commit, a deckbuilder edit), so Start
 * over still goes back to the deck the player brought. `recs: false` leaves the cuts to load later (`ensureCuts`), for
 * the deckbuilder, which shows none. `persist: false` skips writing back to the open deck, for the read that opened it.
 */
export interface SubmitOptions {
  keepOrigin?: boolean;
  recs?: boolean;
  persist?: boolean;
}

/**
 * The account deck the tool is editing, if any, and how its last write went.
 *
 * "dirty" is the window between a change and the write that follows it; the deck on the server is a version behind
 * until it clears, which is what the status line in the header is telling the player.
 */
export interface OpenDeck {
  deckId: DeckId;
  code: string;
  name: string;
  status: "saved" | "saving" | "dirty" | "error";
  /** Why the last write failed, so the player is told rather than losing work silently. */
  message?: string;
}

/** `original` when `deck` differs from it (commanders or main deck), so a save only keeps an original that means something. */
export function changedOriginal(original: DeckInput | null, deck: DeckInput): DeckInput | undefined {
  if (!original) return undefined;
  const sameCommanders = [...original.commanders].sort().join() === [...deck.commanders].sort().join();
  const diff = deckDiff(original, deck);
  return sameCommanders && diff.removed.length === 0 && diff.added.length === 0 ? undefined : original;
}

/** Steps of reloading recommendations after new play-rate data arrives. */
export type RefreshStage = "rating" | "cuts" | "adds";

/** Decklist text for resolved lines, so an imported deck can be edited like a pasted one. */
function decklistText(lines: readonly ResolvedLine[]): string {
  const raw = (commander: boolean) =>
    lines.filter((l) => (l.line.section === "commander") === commander).map((l) => l.line.raw.trim());
  return ["Commander", ...raw(true), "", "Deck", ...raw(false), ""].join("\n");
}

/** A collection applied to suggestions: whose cards, and whether they are the only ones suggested or just come first. */
interface CollectionUse {
  ownership: OwnershipInput;
  mode: OwnershipMode;
}

function buildContext(
  analysis: DeckAnalysis,
  bracketOverride: Bracket | null,
  collection: CollectionUse | null,
): RecContext {
  const bracket = bracketOverride ?? analysis.estimatedBracket;
  return {
    deck: analysis.deck,
    bracket,
    bracketSource: bracketOverride === null ? "inferred" : "user",
    includeGameChangers: defaultIncludeGameChangers(bracket),
    ownership: collection?.ownership ?? null,
    ...(collection ? { ownershipMode: collection.mode } : {}),
  };
}

/**
 * The collection setting a context carries, as one comparable value: when it changes under suggestions already on
 * screen (a collection that finished loading after the deck was analyzed), they were made without it.
 */
function collectionKey(collection: CollectionUse | null): string {
  if (!collection) return "off";
  const { ownership, mode } = collection;
  return ownership.kind === "session"
    ? `session:${ownership.catalogEpoch}:${ownership.ownedCardIds.length}:${mode}`
    : `${ownership.kind}:${mode}`;
}

/** What a collection does to suggestions: nothing, owned cards first, or owned cards only. */
export type CollectionMode = "off" | OwnershipMode;

/**
 * Why the settings suggestions are made with changed. A bracket change says what the bracket was, so a journey part
 * way through can check the deck against the new one and offer to go back.
 */
export type ContextChange = { kind: "bracket"; previous: Bracket | null } | { kind: "collection" } | { kind: "playRates" };

/**
 * The player's last choice, remembered in this browser. The key predates "owned first", when "1" meant owned-only and
 * "0" meant off, so those values still read that way. With no choice yet, a collection puts owned cards first: it
 * changes the order without hiding anything, which is what someone who just imported one expects.
 */
const COLLECTION_MODE_KEY = "mtg-deck-rec:owned-only";
const STORED_MODE: Record<string, CollectionMode> = { "1": "only", "0": "off", first: "first", only: "only", off: "off" };

function readCollectionMode(): CollectionMode {
  try {
    const stored = typeof window === "undefined" ? null : localStorage.getItem(COLLECTION_MODE_KEY);
    return (stored !== null && STORED_MODE[stored]) || "first";
  } catch {
    return "first";
  }
}

function writeCollectionMode(mode: CollectionMode) {
  try {
    localStorage.setItem(COLLECTION_MODE_KEY, mode);
  } catch {
    // Storage is blocked; the choice just won't be remembered.
  }
}

/**
 * State for the deck tool. Requests fire from event handlers (not effects), except when the collection arrives after
 * the deck was analyzed; request counters drop responses that arrive after a newer request started.
 *
 * `onContextChange` hears about every change to the settings suggestions are made with while the deck stays the same
 * (bracket, collection, new play-rate data), so lists built on top of the tool (the journey's) can reload. It resolves
 * once they have.
 */
export function useDeckTool(
  source: CollectionSource,
  { onContextChange }: { onContextChange?: (context: RecContext, change: ContextChange) => Promise<void> } = {},
) {
  const [text, setText] = useState("");
  const [parse, setParse] = useState<Async<null>>({ status: "idle" });
  const [lines, setLines] = useState<ResolvedLine[]>([]);
  const [analysis, setAnalysis] = useState<DeckAnalysis | null>(null);
  /** The decklist text `analysis` was read from: when the box no longer holds it, the analysis is out of date. */
  const [analyzedText, setAnalyzedText] = useState<string | null>(null);
  /** Counts analyses, so whatever builds on one (the journey) can tell a new deck from new settings for the same one. */
  const [round, setRound] = useState(0);
  const [bracketOverride, setBracketOverride] = useState<Bracket | null>(null);
  const [cut, setCut] = useState<Async<CutResult>>({ status: "idle" });
  const [importedFrom, setImportedFrom] = useState<ImportedFrom | null>(null);
  const [openDeck, setOpenDeck] = useState<OpenDeck | null>(null);
  /** The decklist the player brought, before any journey result replaced it: what Start over goes back to. */
  const [originText, setOriginText] = useState<string | null>(null);
  /**
   * The remembered deck put back in the box on this visit, with its bracket and Game Changer choices. Analyze replays
   * those choices only while the box still holds that exact text: an edited deck is a new deck.
   */
  const [restored, setRestored] = useState<SavedDeck | null>(null);
  /**
   * The same deck as analyzed, for saving beside the result. A ref, like the open deck: submit() persists in the same
   * handler that may have just set it.
   */
  const originDeckRef = useRef<DeckInput | null>(null);
  const [originDeck, setOriginDeck] = useState<DeckInput | null>(null);
  /*
   * The open deck is read inside submit(), which the caller may run before a setState from the same handler has been
   * applied, so the ref is what the writes go by and the state is what the screen shows.
   */
  const openDeckRef = useRef<OpenDeck | null>(null);
  const saveRequest = useRef(0);
  /** The write auto-save has in flight, so a caller can wait for the account to have the deck before leaving. */
  const pendingSave = useRef<Promise<void>>(Promise.resolve());
  const recsRequest = useRef(0);
  /** The collection setting the analysis's suggestions were made with; null before there is an analysis. */
  const suggestedWith = useRef<string | null>(null);
  const contextChange = useRef(onContextChange);
  useEffect(() => {
    contextChange.current = onContextChange;
  });

  const [collectionMode, setCollectionMode] = useState<CollectionMode>(readCollectionMode);
  const browserCollection = source.kind === "browser" ? source.collection : null;
  const ownedIds = useMemo(() => (browserCollection ? ownedCardIds(browserCollection) : null), [browserCollection]);
  const hasCollection = source.kind === "browser" || source.kind === "account";
  /**
   * A collection mode needs a collection; without one the choice is kept but not applied. A browser collection sends
   * its card ids; an account collection is read on the server.
   */
  const ownershipFor = (mode: CollectionMode): CollectionUse | null => {
    if (mode === "off") return null;
    if (browserCollection && ownedIds) {
      return { ownership: { kind: "session", catalogEpoch: browserCollection.catalogEpoch, ownedCardIds: ownedIds }, mode };
    }
    return source.kind === "account" ? { ownership: { kind: "account" }, mode } : null;
  };
  const ownership = ownershipFor(collectionMode);
  const ownershipKey = collectionKey(ownership);

  const context = analysis ? buildContext(analysis, bracketOverride, ownership) : null;

  async function loadCuts(ctx: RecContext, collection: CollectionUse | null) {
    const id = ++recsRequest.current;
    suggestedWith.current = collectionKey(collection);
    setCut({ status: "loading" });
    const r = await getApis().recs.cut({ context: ctx });
    if (id === recsRequest.current) setCut(toAsync(r));
  }

  /**
   * The same deck under new settings: reloads the cuts (unless the deckbuilder has them waiting for Upgrade) and tells
   * whatever builds on the tool.
   */
  function reloadFor(ctx: RecContext, collection: CollectionUse | null, change: ContextChange) {
    if (cut.status === "idle") suggestedWith.current = collectionKey(collection);
    else void loadCuts(ctx, collection);
    void contextChange.current?.(ctx, change);
  }

  /*
   * The collection is read after the page mounts, so a deck analyzed first had its suggestions made without it. When
   * the collection (or its setting) differs from the one they were made with, they are made again. The handlers that
   * change the setting reload on their own and record it first, so this only acts on changes from outside. It also
   * runs on each new analysis, since a collection that arrived while the decklist was being read was not in the
   * request that read it.
   */
  useEffect(() => {
    if (!analysis || suggestedWith.current === null || suggestedWith.current === ownershipKey) return;
    reloadFor(buildContext(analysis, bracketOverride, ownership), ownership, { kind: "collection" });
    // Keyed on the collection and the analysis: the bracket has a handler of its own that reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownershipKey, analysis]);

  function trackOpenDeck(next: OpenDeck | null) {
    openDeckRef.current = next;
    setOpenDeck(next);
  }

  /**
   * Writes the deck back to the account deck it was opened from.
   *
   * Only the cards and the bracket go: visibility is the deck page's to set, and save_deck deliberately leaves it
   * alone, so auto-saving can never republish a deck its owner has hidden. A stale write is dropped by the counter,
   * so the last edit wins rather than whichever request happens to land last.
   */
  async function persist(analysis: DeckAnalysis, bracket: Bracket | null) {
    const deck = openDeckRef.current;
    if (!deck) return;
    const id = ++saveRequest.current;
    trackOpenDeck({ ...deck, status: "saving" });
    const original = changedOriginal(originDeckRef.current, analysis.deck);
    const r = await getApis().actions.saveDeck({
      deckId: deck.deckId,
      name: deck.name,
      deck: analysis.deck,
      isPublic: true,
      ...(bracket === null ? {} : { bracket }),
      ...(original ? { original } : {}),
    });
    if (id !== saveRequest.current) return;
    const current = openDeckRef.current;
    if (!current || current.deckId !== deck.deckId) return;
    trackOpenDeck(r.ok ? { ...current, status: "saved" } : { ...current, status: "error", message: r.error.message });
  }

  /**
   * Opens one of the signed-in player's saved decks and analyzes it, so editing carries on where they left off.
   * Every later change is written back to the same deck; the read that opens it is not, since nothing has changed.
   */
  async function openSavedDeck(code: string): Promise<Result<SubmitOutcome>> {
    const r = await getApis().actions.openSavedDeck({ code });
    if (!r.ok) return r;
    const { deckId, name, bracket, text: deckText } = r.data;
    trackOpenDeck({ deckId, code: r.data.code, name, status: "saved" });
    setText(deckText);
    return {
      ok: true,
      data: await submit({ text: deckText, bracketOverride: bracket ?? null, importedFrom: null }, { persist: false }),
    };
  }

  /**
   * Parses (or imports) the decklist and loads recommendations, then remembers the deck in this browser. `restore`
   * replays a given deck with its bracket and Game Changer choices; without it, the remembered deck put back in the
   * box is replayed the same way while its text is unchanged. See SubmitOptions for the rest.
   */
  async function submit(
    restore?: SavedDeck,
    { keepOrigin = false, recs = true, persist: writeBack = true }: SubmitOptions = {},
  ): Promise<SubmitOutcome> {
    // Analyzing the remembered deck untouched keeps the choices it was saved with.
    const replay = restore ?? (restored !== null && restored.text === text ? restored : undefined);
    setRestored(null);
    setParse({ status: "loading" });
    const deckText = replay?.text ?? text;
    const input = deckText.trim();
    const { actions } = getApis();
    const r: Result<ParseDeckResult | ImportDeckUrlResult> = DECK_LINK.test(input)
      ? await actions.importDeckFromUrl({ url: input })
      : await actions.parseDeck({ text: deckText });
    if (!r.ok) {
      setParse({ status: "error", message: r.error.message });
      return { parsed: false, analysis: null };
    }
    const wasImported = "sourceUrl" in r.data;
    const source = "sourceUrl" in r.data ? { source: r.data.source, url: r.data.sourceUrl } : (replay?.importedFrom ?? null);
    const finalText = wasImported ? decklistText(r.data.lines) : deckText;
    const bracket = replay?.bracketOverride ?? null;

    recsRequest.current++;
    setRound((n) => n + 1);
    setText(finalText);
    setAnalyzedText(finalText);
    if (!keepOrigin) {
      setOriginText(finalText);
      originDeckRef.current = r.data.analysis?.deck ?? null;
      setOriginDeck(originDeckRef.current);
    }
    setImportedFrom(source);
    setParse({ status: "ready", data: null });
    setLines(r.data.lines);
    setAnalysis(r.data.analysis);
    setBracketOverride(bracket);
    saveDeck({ text: finalText, bracketOverride: bracket, importedFrom: source });
    if (r.data.analysis) {
      if (recs) void loadCuts(buildContext(r.data.analysis, bracket, ownership), ownership);
      else {
        suggestedWith.current = ownershipKey;
        setCut({ status: "idle" });
      }
      // Every path that changes the deck goes through here, so this is the one place auto-save has to hang off.
      if (writeBack && openDeckRef.current) pendingSave.current = persist(r.data.analysis, bracket);
    } else {
      suggestedWith.current = null;
      setCut({ status: "idle" });
    }
    return { parsed: true, analysis: r.data.analysis };
  }

  /**
   * Loads the cuts a deckbuilder edit left waiting (`recs: false`), for when the player goes back to Upgrade. Does
   * nothing when they are already loaded or loading.
   */
  function ensureCuts() {
    if (analysis && context && cut.status === "idle") void loadCuts(context, ownership);
  }

  /**
   * Puts the deck from the last visit back in the decklist box without analyzing it: opening the tool must not run an
   * old deck on its own. Returns false when there was none to restore.
   */
  function restoreLastDeck(): boolean {
    const saved = loadSavedDeck();
    if (!saved) return false;
    setText(saved.text);
    setRestored(saved);
    return true;
  }

  /**
   * Analyzes the current deck again and reloads cuts, then whatever builds on the tool, reporting each stage. Used
   * when a commander deck lookup has rebuilt the play-rate data. The deck is unchanged, so this is not a new round:
   * the journey keeps the player's choices. Each stage waits for both its work and the promise `onStage` returns, so
   * the caller can keep a stage on screen long enough to read. Resolves to the new analysis, or null when there's no
   * deck or it failed.
   */
  async function refreshRecommendations(onStage: (stage: RefreshStage) => Promise<void>): Promise<DeckAnalysis | null> {
    if (!analysis) return null;
    const id = ++recsRequest.current;
    const { actions, recs } = getApis();
    const [analyzed] = await Promise.all([actions.analyzeDeck({ deck: analysis.deck }), onStage("rating")]);
    if (!analyzed.ok) return null;
    // A newer deck or setting change owns the panels now; the analysis still tells the caller what the lookup found.
    if (id !== recsRequest.current) return analyzed.data;
    setAnalysis(analyzed.data);
    const ctx = buildContext(analyzed.data, bracketOverride, ownership);
    suggestedWith.current = ownershipKey;
    setCut({ status: "loading" });
    const [cutResult] = await Promise.all([recs.cut({ context: ctx }), onStage("cuts")]);
    if (id !== recsRequest.current) return analyzed.data;
    setCut(toAsync(cutResult));
    await Promise.all([contextChange.current?.(ctx, { kind: "playRates" }), onStage("adds")]);
    return analyzed.data;
  }

  /** Puts a decklist the tool produced (a journey's result, a deckbuilder edit) in the box and analyzes it, keeping the player's settings. */
  function commitText(nextText: string, { recs = true }: { recs?: boolean } = {}): Promise<SubmitOutcome> {
    setText(nextText);
    return submit({ text: nextText, bracketOverride, importedFrom: null }, { keepOrigin: true, recs });
  }

  /** Goes back to the decklist the player brought and analyzes it again. */
  function startOver(): Promise<SubmitOutcome> {
    if (originText === null) return Promise.resolve({ parsed: false, analysis: null });
    return commitText(originText);
  }

  /** Forgets the deck here and in this browser's storage. */
  function clearDeck() {
    clearSavedDeck();
    setRestored(null);
    setOriginText(null);
    originDeckRef.current = null;
    setOriginDeck(null);
    // Let go of the account deck rather than emptying it: Clear means "not working on this now", not "delete it".
    trackOpenDeck(null);
    saveRequest.current++;
    recsRequest.current++;
    suggestedWith.current = null;
    setRound((n) => n + 1);
    setText("");
    setAnalyzedText(null);
    setParse({ status: "idle" });
    setLines([]);
    setAnalysis(null);
    setImportedFrom(null);
    setBracketOverride(null);
    setCut({ status: "idle" });
  }

  function changeBracket(bracket: Bracket) {
    setBracketOverride(bracket);
    updateSavedDeck({ bracketOverride: bracket });
    if (!analysis) return;
    reloadFor(buildContext(analysis, bracket, ownership), ownership, { kind: "bracket", previous: bracketOverride });
    // The bracket is stored on the deck, so it is a change to write back; the cards are unchanged. Tracked like any
    // other write, so leaving for the deck's editor waits for it.
    if (openDeckRef.current) pendingSave.current = persist(analysis, bracket);
  }

  /** Changes what the collection does to suggestions and reloads them with it. */
  function changeCollectionMode(mode: CollectionMode) {
    setCollectionMode(mode);
    writeCollectionMode(mode);
    const collection = ownershipFor(mode);
    if (analysis) reloadFor(buildContext(analysis, bracketOverride, collection), collection, { kind: "collection" });
  }

  /**
   * Puts back the bracket from before a change the player then took back (the journey's Revert). Only the cuts reload:
   * whatever builds on the tool kept its lists from before the change, so it isn't told.
   */
  function restoreBracket(bracket: Bracket | null) {
    setBracketOverride(bracket);
    updateSavedDeck({ bracketOverride: bracket });
    if (!analysis) return;
    if (cut.status !== "idle") void loadCuts(buildContext(analysis, bracket, ownership), ownership);
    // An estimated bracket has nothing to write: the deck keeps the one the change stored until the player picks again.
    if (openDeckRef.current && bracket !== null) pendingSave.current = persist(analysis, bracket);
  }

  /** Stops editing the account deck but keeps the decklist on screen: Clear is what empties the tool. */
  function closeSavedDeck() {
    saveRequest.current++;
    trackOpenDeck(null);
  }

  /** Remembers the deck a fresh save created, so later edits update it instead of making another one. */
  function trackSavedDeck(saved: Pick<SavedDeckContents, "deckId" | "code" | "name">) {
    trackOpenDeck({ ...saved, status: "saved" });
  }

  return {
    text,
    setText,
    loadSample: () => setText(sampleDecklist),
    submit,
    openSavedDeck,
    openDeck,
    closeSavedDeck,
    trackSavedDeck,
    restoreLastDeck,
    /** True while the box holds the remembered deck, untouched, and it has not been analyzed yet. */
    showsRestoredDeck: restored !== null && restored.text === text,
    refreshRecommendations,
    commitText,
    /** Resolves once the open deck's last auto-save has landed (or failed, which the open deck bar reports). */
    whenSaved: () => pendingSave.current,
    startOver,
    originText,
    /** The deck the player brought, when the current deck differs from it: what a save keeps as its original. */
    original: analysis ? changedOriginal(originDeck, analysis.deck) : undefined,
    clearDeck,
    parse,
    importedFrom,
    lines,
    unresolvedLines: lines.filter((l) => l.resolution.status !== "resolved"),
    analysis,
    /** Changes with each analysis (and Clear), not with settings. */
    round,
    /** True when the decklist box no longer holds the text the analysis on screen was read from. */
    stale: analysis !== null && text !== analyzedText,
    context,
    /** The player's own bracket choice; null while the bracket is estimated. */
    bracketOverride,
    changeBracket,
    restoreBracket,
    /** null when there's no collection to apply. */
    collectionMode: hasCollection ? collectionMode : null,
    changeCollectionMode,
    cut,
    ensureCuts,
  };
}

export type DeckTool = ReturnType<typeof useDeckTool>;
