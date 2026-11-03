"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { AddSuggestion, CardId, CardSummary } from "@mtg/core/contract";
import { basicToSwap, deckKey, fitsLandSwap, journeyReducer, workingDeck, type LandSwapMode, type StatLine } from "@mtg/core/journey";
import { Button } from "@/components/ui/button";
import { getApis } from "@/lib/api/client";
import { displayName } from "@/lib/cards";
import { PanelError, PanelLoading } from "../panel-state";
import type { Async } from "../use-deck-tool";
import { SingleSwipe, SwipeDone } from "./single-swipe";
import type { DeckJourney } from "./use-deck-journey";

/** Candidates after the one on screen whose rules text is fetched ahead. */
const PREFETCH_CARDS = 4;

/** What a land swap is for: the mode and the Deck stats line it brings back on target. */
export interface LandSwapNeed {
  mode: LandSwapMode;
  line: StatLine;
}

/**
 * Land swaps (T083): while the deck runs too many lands (or basics), deal one card at a time to go in for a copy of the
 * basic it runs most of. Spells for too many lands, nonbasic lands for too many basics. The candidates are Add's, for
 * the deck with that basic out, so they follow the roles it is short of and the collection setting; a swap takes the
 * basic out and the card in as one choice, so the deck keeps its size. Deck stats re-tallies as cards go, and the need
 * ends once the line is back on target.
 */
export function LandSwaps({
  journey,
  need,
  doneLabel,
  onDone,
}: {
  journey: DeckJourney;
  need: LandSwapNeed;
  /** The way on, under the card and when the candidates run out. */
  doneLabel: string;
  onDone: () => void;
}) {
  const state = journey.state;
  const context = journey.workingContext;
  const basic = state ? basicToSwap(state, journey.cards) : null;
  const without = state && basic ? journeyReducer(state, { type: "cut", card: basic }) : null;
  // The settings go in the key too, so a bracket or collection change asks again.
  const key =
    without && context
      ? `${deckKey(workingDeck(without))}|${context.bracket}|${context.includeGameChangers}|${context.ownership ? (context.ownershipMode ?? "only") : "none"}`
      : null;
  const [list, setList] = useState<{ key: string; value: Async<AddSuggestion[]> } | null>(null);
  /** What the request reads, as of the latest render: the request goes out per deck, not per render. */
  const inputs = useRef({ without, context });
  useEffect(() => {
    inputs.current = { without, context };
  });

  useEffect(() => {
    const { without, context } = inputs.current;
    if (!without || !context || key === null) return;
    let live = true;
    const deck = workingDeck(without);
    void getApis()
      .recs.add({ context: { ...context, deck }, excludeCardIds: without.declinedAdds })
      .then((r) => {
        if (!live) return;
        setList({
          key,
          value: r.ok
            ? { status: "ready", data: r.data.groups.flatMap((g) => g.suggestions).sort((a, b) => b.score.total - a.score.total) }
            : { status: "error", message: r.error.message },
        });
      });
    return () => {
      live = false;
    };
  }, [key]);

  if (!state || !basic) return null;
  // A list for another deck (the one before the last swap) is stale: the next one is on its way.
  const value = list?.key === key ? list.value : null;
  if (!value || value.status === "loading" || value.status === "idle") return <PanelLoading label="Finding cards to swap in for lands" />;
  if (value.status === "error") return <PanelError message={value.message} />;

  const declined = new Set<CardId>(state.declinedAdds);
  const queue: CardSummary[] = value.data.filter((s) => fitsLandSwap(need.mode, s.card) && !declined.has(s.card.id)).map((s) => s.card);
  const next = queue[0];
  const done = (
    <Button type="button" size="sm" variant="link" onClick={onDone}>
      {doneLabel}
    </Button>
  );
  if (!next) {
    return (
      <SwipeDone title="No more cards to swap in for lands" message={`The deck runs ${need.line.value} ${need.line.label.toLowerCase()}.`}>
        <Button type="button" size="lg" onClick={onDone}>
          {doneLabel}
        </Button>
      </SwipeDone>
    );
  }
  const name = displayName(next);
  return (
    <SingleSwipe
      card={next}
      position={1}
      total={queue.length}
      label={need.mode === "spells" ? "Spells for lands" : "Lands for basics"}
      tone="primary"
      previewAs="add"
      acceptIcon={ArrowLeftRight}
      upcoming={queue.slice(1, PREFETCH_CARDS + 1).map((c) => c.id)}
      acceptLabel={`Swap a ${basic.name} for ${name}`}
      passLabel={`Pass on ${name}`}
      acceptWord="Swap in"
      passWord="Next one"
      caption={`Swap a ${basic.name} for this. ${need.line.value} ${need.line.label.toLowerCase()}; about ${Math.round(need.line.target)} is typical.`}
      onAccept={() => journey.swapLand(basic, next)}
      onPass={() => journey.dispatch({ type: "declineAdd", cardId: next.id })}
      footer={done}
    />
  );
}
