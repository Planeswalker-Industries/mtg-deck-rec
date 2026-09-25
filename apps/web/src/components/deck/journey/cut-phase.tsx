"use client";

import type { CardSummary, CutReason, CutResult } from "@mtg/core/contract";
import { Button } from "@/components/ui/button";
import { cutReasonLabel, cutReasonShortLabel } from "@/lib/labels";
import { DeckGroupsPanel } from "../deck-groups-panel";
import { PanelError } from "../panel-state";
import { ShuffleDeck } from "../shuffle-deck";
import type { DeckGroups } from "../use-deck-groups";
import type { Async } from "../use-deck-tool";
import { NextBar, PhaseIntro } from "./journey-stepper";
import { SingleSwipe, SwipeDone } from "./single-swipe";
import type { DeckJourney } from "./use-deck-journey";

/** Reasons shown under a card. NOT_OWNED is left out: it is about the collection, not the card working against the deck. */
const MAX_REASONS = 2;

function reasonText(reasons: readonly CutReason[]): string {
  return reasons
    .filter((r) => r !== "NOT_OWNED")
    .slice(0, MAX_REASONS)
    .map((r) => cutReasonLabel[r])
    .join(". ");
}

/**
 * Cut: the cards that work against the deck. Swiping deals them one at a time (✅ cut, ❌ keep). The list shows the whole
 * deck with them crossed out; tapping any card marks or unmarks it, so the player can cut cards of their own too.
 */
export function CutPhase({
  journey,
  cutState,
  view,
  deckGroups,
}: {
  journey: DeckJourney;
  cutState: Async<CutResult>;
  view: "swipe" | "list";
  deckGroups: DeckGroups;
}) {
  const { recommended, undecided, slotsAfter, isMarked, toggle, finish } = journey.cut;
  const cutCount = journey.state?.cuts.length ?? 0;
  const nextLabel = slotsAfter === 0 ? "Next: replace weaker cards" : `Next: add ${slotsAfter} card${slotsAfter === 1 ? "" : "s"}`;

  if (cutState.status === "loading" || cutState.status === "idle") return <ShuffleDeck label="Finding cards that work against this deck" />;
  if (cutState.status === "error") return <PanelError message={cutState.message} />;

  const reasonsFor = new Map(recommended.map((s) => [s.card.id as number, s.reasons]));

  if (view === "list") {
    // Undecided recommendations are marked in the list and go with Next, so they count.
    const markedCount = cutCount + undecided.length;
    return (
      <div className="flex flex-col gap-4">
        <PhaseIntro title="Cut">
          {recommended.length === 0
            ? "Nothing in this deck works against it. Tap any card you want gone anyway."
            : "Crossed-out cards work against this deck: they break a rule or this commander's decks all but never run them. Tap a card to keep it, or tap any other card to cut it too."}
        </PhaseIntro>
        <DeckGroupsPanel
          deckGroups={deckGroups}
          selectedCardId={null}
          onSelectCard={(id) => {
            const card = journey.cards.get(id);
            if (card) toggle(card);
          }}
          markFor={(card: CardSummary) => (isMarked(card) ? "cut" : undefined)}
          captionFor={(card: CardSummary) => {
            const reasons = reasonsFor.get(card.id);
            return reasons ? (
              <span className="font-bold text-cut">
                {reasons
                  .filter((r) => r !== "NOT_OWNED")
                  .slice(0, MAX_REASONS)
                  .map((r) => cutReasonShortLabel[r])
                  .join(", ")}
              </span>
            ) : undefined;
          }}
        />
        <NextBar label={nextLabel} onNext={finish}>
          {markedCount} marked to cut
        </NextBar>
      </div>
    );
  }

  const next = undecided[0];
  return (
    <div className="flex flex-col gap-4">
      <PhaseIntro title="Cut" brief="Swipe right to cut, left to keep.">
        Cards that work against this deck: they break a rule, or this commander&apos;s decks all but never run them. Swipe
        right to cut, left to keep.
      </PhaseIntro>
      {next ? (
        <SingleSwipe
          card={next.card}
          position={recommended.length - undecided.length + 1}
          total={recommended.length}
          label="Cards to cut"
          tone="cut"
          acceptLabel={`Cut ${next.card.name}`}
          passLabel={`Keep ${next.card.name}`}
          caption={reasonText(next.reasons)}
          onAccept={() => journey.dispatch({ type: "cut", card: next.card })}
          onPass={() => journey.dispatch({ type: "keep", cardId: next.card.id })}
          footer={
            <Button type="button" size="sm" variant="link" onClick={finish}>
              Cut the rest and move on
            </Button>
          }
        />
      ) : (
        <SwipeDone
          message={
            recommended.length === 0
              ? "Nothing in this deck works against it. Switch to the list to cut any card you want gone anyway."
              : `${cutCount} card${cutCount === 1 ? "" : "s"} to cut. Switch to the list to cut more of your own.`
          }
        >
          <Button type="button" size="lg" onClick={finish}>
            {nextLabel}
          </Button>
        </SwipeDone>
      )}
    </div>
  );
}

