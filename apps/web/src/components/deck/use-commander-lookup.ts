"use client";

import { useEffect, useRef, useState } from "react";
import type { CardSummary, CommanderRequest, CommanderRequestStatus, DeckAnalysis } from "@mtg/core/contract";
import { getApis } from "@/lib/api/client";
import type { RefreshStage } from "./use-deck-tool";

const POLL_MS = 2_000;
/** Reloading recommendations takes well under a second; each step stays up this long so it can be read. */
const STAGE_MIN_MS = 700;
/** Consecutive failed progress checks before the lookup is reported as lost. */
const MAX_POLL_FAILURES = 5;
const ACTIVE: ReadonlySet<CommanderRequestStatus> = new Set(["queued", "checking", "collecting", "aggregating"]);

export type LookupState =
  | { phase: "idle" }
  /** The commander has no deck data and no lookup: ask whether to pull decks. */
  | { phase: "prompt"; commander: CardSummary; estimatedSeconds: number; collectorOnline: boolean; starting: boolean; error: string | null }
  /** The visitor chose not to wait; they can still start a lookup from the deck tool. */
  | { phase: "declined"; commander: CardSummary; estimatedSeconds: number; collectorOnline: boolean }
  /** `found` is true for the first update after the source reported how many decks it lists. */
  | { phase: "running"; request: CommanderRequest; stage: RefreshStage | null; found: boolean }
  | { phase: "complete"; request: CommanderRequest }
  /** Too few decks: the source lists too few, or too few of the collected decks could be used. */
  | { phase: "not_enough"; request: CommanderRequest }
  | { phase: "failed"; commander: CardSummary; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A lone commander with no play data can have decks looked up. Partner pairs aren't supported yet. */
function lookupCommander(analysis: DeckAnalysis | null): CardSummary | null {
  if (!analysis || analysis.commanderKey.confidence !== "none" || analysis.deck.commanders.length !== 1) return null;
  if (analysis.issues.some((i) => i.code === "INVALID_COMMANDER" || i.code === "MISSING_COMMANDER")) return null;
  return analysis.commanderKey.commanders[0] ?? null;
}

/**
 * Deck lookups for a commander we have no play data for: asks the visitor, starts or joins the shared lookup, follows
 * its progress, then reloads recommendations. Every async step checks a run counter, so a newer deck or a reset drops
 * responses from an older one.
 */
export function useCommanderLookup(refresh: (onStage: (stage: RefreshStage) => Promise<void>) => Promise<DeckAnalysis | null>) {
  const [state, setState] = useState<LookupState>({ phase: "idle" });
  const [open, setOpen] = useState(false);
  const run = useRef(0);
  const refreshRef = useRef(refresh);

  useEffect(() => {
    refreshRef.current = refresh;
  });
  useEffect(
    () => () => {
      run.current++;
    },
    [],
  );

  /** Shows a lookup's latest progress and keeps following it until it ends. `previous` is null for the first sighting. */
  function follow(id: number, request: CommanderRequest, previous: CommanderRequest | null) {
    if (ACTIVE.has(request.status)) {
      const found = previous !== null && previous.decksListed === null && request.decksListed !== null;
      setState({ phase: "running", request, stage: null, found });
      void poll(id, request, 0);
    } else if (request.status === "done" && previous !== null) {
      void finish(id, request);
    } else if (request.status === "failed") {
      setState({
        phase: "failed",
        commander: request.commander,
        message: request.error ?? "The deck lookup stopped unexpectedly.",
      });
    } else {
      // Not enough decks, or a lookup that finished before this deck was analyzed and still left it without data.
      setState({ phase: "not_enough", request });
    }
  }

  async function poll(id: number, request: CommanderRequest, failures: number) {
    await sleep(POLL_MS);
    if (id !== run.current) return;
    const r = await getApis().actions.getCommanderRequest({ requestId: request.id });
    if (id !== run.current) return;
    if (r.ok) {
      follow(id, r.data, request);
    } else if (failures + 1 < MAX_POLL_FAILURES && r.error.code !== "NOT_FOUND") {
      void poll(id, request, failures + 1);
    } else {
      setState({ phase: "failed", commander: request.commander, message: "Lost track of the deck lookup. Analyze the deck again to check on it." });
    }
  }

  async function finish(id: number, request: CommanderRequest) {
    setState({ phase: "running", request, stage: "rating", found: false });
    const analysis = await refreshRef.current(async (stage) => {
      if (id !== run.current) return;
      setState({ phase: "running", request, stage, found: false });
      await sleep(STAGE_MIN_MS);
    });
    if (id !== run.current) return;
    if (!analysis) {
      setState({
        phase: "failed",
        commander: request.commander,
        message: "The decks are in, but reloading recommendations failed. Analyze the deck again to see them.",
      });
    } else if (analysis.commanderKey.confidence === "none") {
      setState({ phase: "not_enough", request });
    } else {
      setState({ phase: "complete", request });
    }
  }

  /** Call after each analysis: prompts for a lookup, or picks up one already running for the commander. */
  async function check(analysis: DeckAnalysis | null) {
    const id = ++run.current;
    setState({ phase: "idle" });
    setOpen(false);
    const commander = lookupCommander(analysis);
    if (!commander) return;

    const r = await getApis().actions.getCommanderCoverage({ commanderId: commander.id });
    // Without coverage the deck tool still works on what cards do; there's just no offer to look up decks.
    if (id !== run.current || !r.ok) return;
    const { request, estimatedSeconds, collectorOnline } = r.data;
    if (!request) {
      setState({ phase: "prompt", commander, estimatedSeconds, collectorOnline, starting: false, error: null });
      setOpen(true);
      return;
    }
    follow(id, request, null);
    if (ACTIVE.has(request.status)) setOpen(true);
  }

  async function approve() {
    if (state.phase !== "prompt" && state.phase !== "declined") return;
    const { commander, estimatedSeconds, collectorOnline } = state;
    const id = ++run.current;
    setState({ phase: "prompt", commander, estimatedSeconds, collectorOnline, starting: true, error: null });
    setOpen(true);
    const r = await getApis().actions.requestCommanderDecks({ commanderId: commander.id });
    if (id !== run.current) return;
    if (!r.ok) {
      setState({ phase: "prompt", commander, estimatedSeconds, collectorOnline, starting: false, error: r.error.message });
      return;
    }
    follow(id, r.data, null);
  }

  /** Reopens the prompt after the visitor said "Not now". */
  function reconsider() {
    if (state.phase !== "declined") return;
    setState({ ...state, phase: "prompt", starting: false, error: null });
    setOpen(true);
  }

  /** Closing the sheet: declines a prompt, keeps a running lookup going in the background, dismisses a finished one. */
  function close() {
    setOpen(false);
    if (state.phase === "prompt" && !state.starting) {
      const { commander, estimatedSeconds, collectorOnline } = state;
      setState({ phase: "declined", commander, estimatedSeconds, collectorOnline });
    } else if (state.phase === "complete") {
      setState({ phase: "idle" });
    }
  }

  function reset() {
    run.current++;
    setState({ phase: "idle" });
    setOpen(false);
  }

  return { state, open, check, approve, reconsider, close, show: () => setOpen(true), reset };
}

export type CommanderLookup = ReturnType<typeof useCommanderLookup>;
