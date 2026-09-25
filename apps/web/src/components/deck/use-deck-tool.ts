"use client";

import { useMemo, useRef, useState } from "react";
import type {
  AddResult,
  Bracket,
  CardId,
  CardSummary,
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

/** What a collection does to suggestions: nothing, owned cards first, or owned cards only. */
export type CollectionMode = "off" | OwnershipMode;

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
 * State for the deck tool. Requests fire from event handlers (not effects);
 * request counters drop responses that arrive after a newer request started.
 */
export function useDeckTool(source: CollectionSource) {
  const [text, setText] = useState("");
  const [parse, setParse] = useState<Async<null>>({ status: "idle" });
  const [lines, setLines] = useState<ResolvedLine[]>([]);
  const [analysis, setAnalysis] = useState<DeckAnalysis | null>(null);
  const [bracketOverride, setBracketOverride] = useState<Bracket | null>(null);
  const [add, setAdd] = useState<Async<AddResult>>({ status: "idle" });
  const [cut, setCut] = useState<Async<CutResult>>({ status: "idle" });
  const [swap, setSwap] = useState<SwapState | null>(null);
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
  const swapRequest = useRef(0);

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

  const context = analysis ? buildContext(analysis, bracketOverride, ownership) : null;

  async function loadSwap(ctx: RecContext, targetCardId: CardId) {
    const id = ++swapRequest.current;
    setSwap({ targetCardId, result: { status: "loading" } });
    const r = await getApis().recs.swap({ context: ctx, targetCardId });
    if (id === swapRequest.current) setSwap({ targetCardId, result: toAsync(r) });
  }

  async function loadRecs(ctx: RecContext, swapTarget: CardId | null) {
    const id = ++recsRequest.current;
    setAdd({ status: "loading" });
    setCut({ status: "loading" });
    if (swapTarget !== null) void loadSwap(ctx, swapTarget);
    const { recs } = getApis();
    const [addResult, cutResult] = await Promise.all([recs.add({ context: ctx }), recs.cut({ context: ctx })]);
    if (id !== recsRequest.current) return;
    setAdd(toAsync(addResult));
    setCut(toAsync(cutResult));
  }

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
   * Every later change is written back to the same deck.
   */
  async function openSavedDeck(code: string): Promise<Result<SubmitOutcome>> {
    const r = await getApis().actions.openSavedDeck({ code });
    if (!r.ok) return r;
    const { deckId, name, bracket, text: deckText } = r.data;
    trackOpenDeck({ deckId, code: r.data.code, name, status: "saved" });
    setText(deckText);
    return {
      ok: true,
      data: await submit({ text: deckText, bracketOverride: bracket ?? null, importedFrom: null }),
    };
  }

  /**
   * Parses (or imports) the decklist and loads recommendations, then remembers the deck in this browser. `restore`
   * replays a given deck with its bracket and Game Changer choices; without it, the remembered deck put back in the
   * box is replayed the same way while its text is unchanged. `keepOrigin` marks a result the tool produced (a
   * journey commit, applied swaps), so Start over still goes back to the deck the player brought.
   */
  async function submit(restore?: SavedDeck, { keepOrigin = false }: { keepOrigin?: boolean } = {}): Promise<SubmitOutcome> {
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
    swapRequest.current++;
    setText(finalText);
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
    setSwap(null);
    saveDeck({ text: finalText, bracketOverride: bracket, importedFrom: source });
    if (r.data.analysis) {
      void loadRecs(buildContext(r.data.analysis, bracket, ownership), null);
      // Every path that changes the deck goes through here, so this is the one place auto-save has to hang off.
      if (openDeckRef.current) pendingSave.current = persist(r.data.analysis, bracket);
    } else {
      setAdd({ status: "idle" });
      setCut({ status: "idle" });
    }
    return { parsed: true, analysis: r.data.analysis };
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
   * Analyzes the current deck again and reloads cuts, then adds, reporting each stage. Used when a commander deck
   * lookup has rebuilt the play-rate data. Each stage waits for both its request and the promise `onStage` returns, so
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
    setCut({ status: "loading" });
    setAdd({ status: "loading" });
    const [cutResult] = await Promise.all([recs.cut({ context: ctx }), onStage("cuts")]);
    if (id !== recsRequest.current) return analyzed.data;
    setCut(toAsync(cutResult));
    const [addResult] = await Promise.all([recs.add({ context: ctx }), onStage("adds")]);
    if (id !== recsRequest.current) return analyzed.data;
    setAdd(toAsync(addResult));
    if (swap) void loadSwap(ctx, swap.targetCardId);
    return analyzed.data;
  }

  /**
   * Puts picked replacements into the decklist, each on its cut card's line, then analyzes the deck again. Edits the
   * player's own text where the line can be found, so their sections and notes survive.
   */
  async function applySwaps(swaps: readonly { target: CardSummary; replacement: CardSummary }[]): Promise<SubmitOutcome> {
    const byTarget = new Map(swaps.map((s) => [s.target.id, s.replacement]));
    const textLines = text.split("\n");
    let editedInPlace = true;
    const nextLines = lines.map((l) => {
      const replacement = l.resolution.status === "resolved" && l.line.section === "main" ? byTarget.get(l.resolution.card.id) : undefined;
      if (!replacement) return l;
      const raw = `1 ${replacement.name}`;
      const at = [l.line.lineNo - 1, l.line.lineNo].find((i) => textLines[i]?.trim() === l.line.raw.trim());
      if (at === undefined) editedInPlace = false;
      else textLines[at] = raw;
      return { ...l, line: { ...l.line, raw } };
    });
    const nextText = editedInPlace ? textLines.join("\n") : decklistText(nextLines);
    setText(nextText);
    return submit({ text: nextText, bracketOverride, importedFrom }, { keepOrigin: true });
  }

  /** Puts a decklist the tool produced (a journey's result) in the box and analyzes it, keeping the player's settings. */
  function commitText(nextText: string): Promise<SubmitOutcome> {
    setText(nextText);
    return submit({ text: nextText, bracketOverride, importedFrom: null }, { keepOrigin: true });
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
    swapRequest.current++;
    setText("");
    setParse({ status: "idle" });
    setLines([]);
    setAnalysis(null);
    setImportedFrom(null);
    setBracketOverride(null);
    setAdd({ status: "idle" });
    setCut({ status: "idle" });
    setSwap(null);
  }

  function changeBracket(bracket: Bracket) {
    setBracketOverride(bracket);
    updateSavedDeck({ bracketOverride: bracket });
    if (!analysis) return;
    void loadRecs(buildContext(analysis, bracket, ownership), swap?.targetCardId ?? null);
    // The bracket is stored on the deck, so it is a change to write back; the cards are unchanged.
    if (openDeckRef.current) void persist(analysis, bracket);
  }


  /** Switches owned-only suggestions on or off and reloads cuts, adds and any open swap with the new pool. */
  function changeCollectionMode(mode: CollectionMode) {
    setCollectionMode(mode);
    writeCollectionMode(mode);
    if (analysis) void loadRecs(buildContext(analysis, bracketOverride, ownershipFor(mode)), swap?.targetCardId ?? null);
  }

  function openSwap(targetCardId: CardId) {
    if (context) void loadSwap(context, targetCardId);
  }

  function closeSwap() {
    swapRequest.current++;
    setSwap(null);
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
    applySwaps,
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
    context,
    changeBracket,
    /** null when there's no collection to limit suggestions to. */
    /** null when there's no collection to apply. */
    collectionMode: hasCollection ? collectionMode : null,
    changeCollectionMode,
    add,
    cut,
    swap,
    openSwap,
    closeSwap,
  };
}

export type DeckTool = ReturnType<typeof useDeckTool>;
