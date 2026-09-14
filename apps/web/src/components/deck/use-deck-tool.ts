"use client";

import { useRef, useState } from "react";
import type {
  AddResult,
  Bracket,
  CardId,
  CutResult,
  DeckAnalysis,
  RecContext,
  ResolvedLine,
  Result,
  SwapResult,
} from "@mtg/core/contract";
import { mockDecklistText } from "@mtg/core/mocks";
import { getApis } from "@/lib/api/client";
import { defaultIncludeGameChangers } from "@/lib/labels";

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

  async function submit() {
    setParse({ status: "loading" });
    const r = await getApis().actions.parseDeck({ text });
    if (!r.ok) {
      setParse({ status: "error", message: r.error.message });
      return;
    }
    recsRequest.current++;
    swapRequest.current++;
    setParse({ status: "ready", data: null });
    setLines(r.data.lines);
    setAnalysis(r.data.analysis);
    setBracketOverride(null);
    setGameChangerOverride(null);
    setSwap(null);
    if (r.data.analysis) {
      void loadRecs(buildContext(r.data.analysis, null, null), null);
    } else {
      setAdd({ status: "idle" });
      setCut({ status: "idle" });
    }
  }

  function changeBracket(bracket: Bracket) {
    setBracketOverride(bracket);
    if (analysis) void loadRecs(buildContext(analysis, bracket, gameChangerOverride), swap?.targetCardId ?? null);
  }

  function changeIncludeGameChangers(include: boolean) {
    setGameChangerOverride(include);
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
    parse,
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
