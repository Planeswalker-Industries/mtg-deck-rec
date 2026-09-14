"use client";

import { useRef, useState } from "react";
import type {
  AddResult,
  Bracket,
  CardId,
  CutResult,
  DeckAnalysis,
  ImportDeckUrlResult,
  ParseDeckResult,
  RecContext,
  ResolvedLine,
  Result,
  SwapResult,
} from "@mtg/core/contract";
import { mockDecklistText } from "@mtg/core/mocks";
import { getApis } from "@/lib/api/client";
import { defaultIncludeGameChangers } from "@/lib/labels";
import { clearSavedDeck, loadSavedDeck, saveDeck, updateSavedDeck, type SavedDeck } from "@/lib/saved-deck";

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
): RecContext {
  const bracket = bracketOverride ?? analysis.estimatedBracket;
  return {
    deck: analysis.deck,
    bracket,
    bracketSource: bracketOverride === null ? "inferred" : "user",
    includeGameChangers: gameChangerOverride ?? defaultIncludeGameChangers(bracket),
    ownership: null,
  };
}

/**
 * State for the deck tool. Requests fire from event handlers (not effects);
 * request counters drop responses that arrive after a newer request started.
 */
export function useDeckTool() {
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
  const recsRequest = useRef(0);
  const swapRequest = useRef(0);

  const context = analysis ? buildContext(analysis, bracketOverride, gameChangerOverride) : null;

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

  /**
   * Parses (or imports) the decklist and loads recommendations, then remembers the deck in this browser. `restore`
   * replays a deck saved on an earlier visit, with its bracket and Game Changer choices. Resolves true when it parsed.
   */
  async function submit(restore?: SavedDeck): Promise<boolean> {
    setParse({ status: "loading" });
    const deckText = restore?.text ?? text;
    const input = deckText.trim();
    const { actions } = getApis();
    const r: Result<ParseDeckResult | ImportDeckUrlResult> = DECK_LINK.test(input)
      ? await actions.importDeckFromUrl({ url: input })
      : await actions.parseDeck({ text: deckText });
    if (!r.ok) {
      setParse({ status: "error", message: r.error.message });
      return false;
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
      void loadRecs(buildContext(r.data.analysis, bracket, includeGameChangers), null);
    } else {
      setAdd({ status: "idle" });
      setCut({ status: "idle" });
    }
    return true;
  }

  /** Brings back the deck from the last visit and analyzes it again. Resolves true when there was one to restore. */
  async function restoreLastDeck(): Promise<boolean> {
    const saved = loadSavedDeck();
    if (!saved) return false;
    setText(saved.text);
    return submit(saved);
  }

  /** Forgets the deck here and in this browser's storage. */
  function clearDeck() {
    clearSavedDeck();
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
    if (analysis) void loadRecs(buildContext(analysis, bracket, gameChangerOverride), swap?.targetCardId ?? null);
  }

  function changeIncludeGameChangers(include: boolean) {
    setGameChangerOverride(include);
    updateSavedDeck({ gameChangerOverride: include });
    if (analysis) void loadRecs(buildContext(analysis, bracketOverride, include), swap?.targetCardId ?? null);
  }

  function openSwap(targetCardId: CardId) {
    if (context) void loadSwap(context, targetCardId);
  }

  function closeSwap() {
    swapRequest.current++;
    setSwap(null);
  }

  return {
    text,
    setText,
    loadSample: () => setText(mockDecklistText),
    submit,
    restoreLastDeck,
    clearDeck,
    parse,
    importedFrom,
    lines,
    unresolvedLines: lines.filter((l) => l.resolution.status !== "resolved"),
    analysis,
    context,
    changeBracket,
    changeIncludeGameChangers,
    add,
    cut,
    swap,
    openSwap,
    closeSwap,
  };
}
