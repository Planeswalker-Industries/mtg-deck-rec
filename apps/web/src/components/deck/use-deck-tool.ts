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
  ImportDeckUrlResult,
  OwnershipInput,
  ParseDeckResult,
  RecContext,
  ResolvedLine,
  Result,
  SavedDeckContents,
  SwapResult,
} from "@mtg/core/contract";
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

/** Steps of reloading recommendations after new play-rate data arrives. */
export type RefreshStage = "rating" | "cuts" | "adds";

/** Decklist text for resolved lines, so an imported deck can be edited like a pasted one. */
function decklistText(lines: readonly ResolvedLine[]): string {
  const raw = (commander: boolean) =>
    lines.filter((l) => (l.line.section === "commander") === commander).map((l) => l.line.raw.trim());
  return ["Commander", ...raw(true), "", "Deck", ...raw(false), ""].join("\n");
}

function buildContext(
  analysis: DeckAnalysis,
  bracketOverride: Bracket | null,
  gameChangerOverride: boolean | null,
  ownership: OwnershipInput | null,
): RecContext {
  const bracket = bracketOverride ?? analysis.estimatedBracket;
  return {
    deck: analysis.deck,
    bracket,
    bracketSource: bracketOverride === null ? "inferred" : "user",
    includeGameChangers: gameChangerOverride ?? defaultIncludeGameChangers(bracket),
    ownership,
  };
}

/** Whether the player last chose owned-only suggestions, remembered in this browser. */
const OWNED_ONLY_KEY = "mtg-deck-rec:owned-only";

function readOwnedOnly(): boolean {
  try {
    return typeof window !== "undefined" && localStorage.getItem(OWNED_ONLY_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOwnedOnly(on: boolean) {
  try {
    localStorage.setItem(OWNED_ONLY_KEY, on ? "1" : "0");
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
  const [gameChangerOverride, setGameChangerOverride] = useState<boolean | null>(null);
  const [add, setAdd] = useState<Async<AddResult>>({ status: "idle" });
  const [cut, setCut] = useState<Async<CutResult>>({ status: "idle" });
  const [swap, setSwap] = useState<SwapState | null>(null);
  const [importedFrom, setImportedFrom] = useState<ImportedFrom | null>(null);
  const [openDeck, setOpenDeck] = useState<OpenDeck | null>(null);
  /*
   * The open deck is read inside submit(), which the caller may run before a setState from the same handler has been
   * applied, so the ref is what the writes go by and the state is what the screen shows.
   */
  const openDeckRef = useRef<OpenDeck | null>(null);
  const saveRequest = useRef(0);
  const recsRequest = useRef(0);
  const swapRequest = useRef(0);

  const [ownedOnlyChosen, setOwnedOnlyChosen] = useState(readOwnedOnly);
  const browserCollection = source.kind === "browser" ? source.collection : null;
  const ownedIds = useMemo(() => (browserCollection ? ownedCardIds(browserCollection) : null), [browserCollection]);
  const hasCollection = source.kind === "browser" || source.kind === "account";
  /**
   * Owned-only suggestions need a collection; without one the choice is kept but not applied. A browser collection
   * sends its card ids; an account collection is read on the server.
   */
  const ownershipFor = (on: boolean): OwnershipInput | null => {
    if (!on) return null;
    if (browserCollection && ownedIds) return { kind: "session", catalogEpoch: browserCollection.catalogEpoch, ownedCardIds: ownedIds };
    return source.kind === "account" ? { kind: "account" } : null;
  };
  const ownership = ownershipFor(ownedOnlyChosen);

  const context = analysis ? buildContext(analysis, bracketOverride, gameChangerOverride, ownership) : null;

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
    const r = await getApis().actions.saveDeck({
      deckId: deck.deckId,
      name: deck.name,
      deck: analysis.deck,
      isPublic: true,
      ...(bracket === null ? {} : { bracket }),
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
      data: await submit({ text: deckText, bracketOverride: bracket ?? null, gameChangerOverride: null, importedFrom: null }),
    };
  }

  /**
   * Parses (or imports) the decklist and loads recommendations, then remembers the deck in this browser. `restore`
   * replays a deck saved on an earlier visit, with its bracket and Game Changer choices.
   */
  async function submit(restore?: SavedDeck): Promise<SubmitOutcome> {
    setParse({ status: "loading" });
    const deckText = restore?.text ?? text;
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
    const source = "sourceUrl" in r.data ? { source: r.data.source, url: r.data.sourceUrl } : (restore?.importedFrom ?? null);
    const finalText = wasImported ? decklistText(r.data.lines) : deckText;
    const bracket = restore?.bracketOverride ?? null;
    const includeGameChangers = restore?.gameChangerOverride ?? null;

    recsRequest.current++;
    swapRequest.current++;
    setText(finalText);
    setImportedFrom(source);
    setParse({ status: "ready", data: null });
    setLines(r.data.lines);
    setAnalysis(r.data.analysis);
    setBracketOverride(bracket);
    setGameChangerOverride(includeGameChangers);
    setSwap(null);
    saveDeck({ text: finalText, bracketOverride: bracket, gameChangerOverride: includeGameChangers, importedFrom: source });
    if (r.data.analysis) {
      void loadRecs(buildContext(r.data.analysis, bracket, includeGameChangers, ownership), null);
      // Every path that changes the deck goes through here, so this is the one place auto-save has to hang off.
      if (openDeckRef.current) void persist(r.data.analysis, bracket);
    } else {
      setAdd({ status: "idle" });
      setCut({ status: "idle" });
    }
    return { parsed: true, analysis: r.data.analysis };
  }

  /** Brings back the deck from the last visit and analyzes it again. `parsed` is false when there was none to restore. */
  async function restoreLastDeck(): Promise<SubmitOutcome> {
    const saved = loadSavedDeck();
    if (!saved) return { parsed: false, analysis: null };
    setText(saved.text);
    return submit(saved);
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
    const ctx = buildContext(analyzed.data, bracketOverride, gameChangerOverride, ownership);
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
    return submit({ text: nextText, bracketOverride, gameChangerOverride, importedFrom });
  }

  /** Forgets the deck here and in this browser's storage. */
  function clearDeck() {
    clearSavedDeck();
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
    setGameChangerOverride(null);
    setAdd({ status: "idle" });
    setCut({ status: "idle" });
    setSwap(null);
  }

  function changeBracket(bracket: Bracket) {
    setBracketOverride(bracket);
    updateSavedDeck({ bracketOverride: bracket });
    if (!analysis) return;
    void loadRecs(buildContext(analysis, bracket, gameChangerOverride, ownership), swap?.targetCardId ?? null);
    // The bracket is stored on the deck, so it is a change to write back; the cards are unchanged.
    if (openDeckRef.current) void persist(analysis, bracket);
  }

  function changeIncludeGameChangers(include: boolean) {
    setGameChangerOverride(include);
    updateSavedDeck({ gameChangerOverride: include });
    if (analysis) void loadRecs(buildContext(analysis, bracketOverride, include, ownership), swap?.targetCardId ?? null);
  }

  /** Switches owned-only suggestions on or off and reloads cuts, adds and any open swap with the new pool. */
  function changeOwnedOnly(on: boolean) {
    setOwnedOnlyChosen(on);
    writeOwnedOnly(on);
    if (analysis) void loadRecs(buildContext(analysis, bracketOverride, gameChangerOverride, ownershipFor(on)), swap?.targetCardId ?? null);
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
    refreshRecommendations,
    applySwaps,
    clearDeck,
    parse,
    importedFrom,
    lines,
    unresolvedLines: lines.filter((l) => l.resolution.status !== "resolved"),
    analysis,
    context,
    changeBracket,
    changeIncludeGameChangers,
    /** null when there's no collection to limit suggestions to. */
    ownedOnly: hasCollection ? ownedOnlyChosen : null,
    changeOwnedOnly,
    add,
    cut,
    swap,
    openSwap,
    closeSwap,
  };
}
