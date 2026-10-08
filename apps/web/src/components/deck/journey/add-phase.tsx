"use client";

import type { AddSuggestion, CardSummary } from "@mtg/core/contract";
import { isFrontLand } from "@mtg/core/scoring";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { PHONE_HIT_AREA, TEXT_LINK } from "@/lib/constants";
import { formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { OwnedBadge } from "../card-label";
import { PanelError, PanelLoading } from "../panel-state";
import { NextBar, PhaseIntro } from "./journey-stepper";
import { SingleSwipe, SwipeDone } from "./single-swipe";
import { SlotTray } from "./slot-tray";
import type { DeckJourney } from "./use-deck-journey";

/** How many suggestions the list view shows at once; the rest follow as these are added or skipped. */
const LIST_SUGGESTIONS = 18;

/** What "Find …" in Deck stats narrowed Add to. */
export type AddFilter = { kind: "role"; roleId: string; label: string } | { kind: "lands" };

const matches = (filter: AddFilter, card: CardSummary) =>
  filter.kind === "lands" ? isFrontLand(card.typeLine) : (card.roles ?? []).includes(filter.roleId);

/** Why a suggestion is here, in one or two short lines. */
function Why({ suggestion }: { suggestion: AddSuggestion }) {
  const { card, fillsRoles, corpus, owned } = suggestion;
  return (
    <span className="flex flex-col items-center gap-0.5 [li_&]:items-start">
      {owned && <OwnedBadge />}
      {fillsRoles.length > 0 && <span className="font-semibold text-add">Adds {fillsRoles.map((r) => r.label.toLowerCase()).join(", ")}</span>}
      {corpus && (
        <span className="font-mono">{corpus.limited ? "New card, little play data yet" : `In ${formatPercent(corpus.inclusionRate)} of decks`}</span>
      )}
      <span className="font-mono">{card.price ? `About ${formatUsd(card.price.usd)}` : "No price"}</span>
    </span>
  );
}

/**
 * Add: fill the slots the cuts opened. Suggestions come best first; adding one asks for the list again, because the
 * card just added may fill the gap the next ones were suggested for. Skipping just moves on. The player can stop with
 * slots still open; Review then says the deck is short.
 *
 * Deck stats can narrow the list to one role or to lands (`filter`); "Show all" puts the whole list back.
 */
export function AddPhase({
  journey,
  view,
  filter,
  onClearFilter,
}: {
  journey: DeckJourney;
  view: "swipe" | "list";
  filter: AddFilter | null;
  onClearFilter: () => void;
}) {
  const { state: addState, queue, landsShort, accept, pass, undo } = journey.add;
  const adds = journey.state?.adds ?? [];
  const open = journey.openSlots;
  // Filled slots plus open ones: the room this round's additions have to fill.
  const slots = open + adds.length;
  const toReplace = () => journey.goTo("replace");
  const asOf = queue.find((s) => s.card.price)?.card.price?.asOf;
  const shown = filter ? queue.filter((s) => matches(filter, s.card)) : queue;
  const filterName = filter ? (filter.kind === "lands" ? "lands" : filter.label.toLowerCase()) : null;

  const intro = (
    <PhaseIntro
      title="Add"
      brief={view === "swipe" && open > 0 ? "Swipe right to add, left to skip." : undefined}
    >
      {open === 0
        ? "Every slot is filled again."
        : `${open} of ${slots} slot${slots === 1 ? "" : "s"} open. Cards decks like yours run and this one doesn't, best first${landsShort ? ", lands first while the mana base is short" : ""}. Each card you add changes what's suggested next.`}
    </PhaseIntro>
  );

  const body = (() => {
    if (open === 0) {
      return (
        <SwipeDone message="Next, look at the cards something else could do better.">
          <Button type="button" size="lg" onClick={toReplace}>
            Next: replace weaker cards
          </Button>
        </SwipeDone>
      );
    }
    if (addState.status === "loading" || addState.status === "idle") return <PanelLoading label="Finding cards to add" />;
    if (addState.status === "error") return <PanelError message={addState.message} />;
    if (queue.length === 0) {
      return (
        <SwipeDone message="That's every suggestion for now. You can go on with slots open, or edit the deck later.">
          <Button type="button" size="lg" onClick={toReplace}>
            Next: replace weaker cards
          </Button>
        </SwipeDone>
      );
    }
    if (shown.length === 0) {
      return (
        <SwipeDone message={`No ${filterName} in the suggestions right now.`}>
          <Button type="button" size="lg" onClick={onClearFilter}>
            Show all
          </Button>
        </SwipeDone>
      );
    }

    if (view === "list") {
      return (
        <PocketGrid
          zoomable
          label="Cards to add"
          onSelect={(card: CardSummary) => accept(card)}
          items={shown.slice(0, LIST_SUGGESTIONS).map((s) => ({ card: s.card, caption: <Why suggestion={s} /> }))}
        />
      );
    }

    const next = shown[0]!;
    return (
      <SingleSwipe
        card={next.card}
        position={adds.length + 1}
        total={slots}
        label="Cards to add"
        tone="add"
        acceptLabel={`Add ${next.card.name}`}
        passLabel={`Skip ${next.card.name}`}
        caption={<Why suggestion={next} />}
        onAccept={() => accept(next.card)}
        onPass={() => pass(next.card)}
        footer={
          <Button type="button" size="sm" variant="link" onClick={toReplace}>
            Done adding for now
          </Button>
        }
      />
    );
  })();

  return (
    <div className="flex flex-col gap-4">
      {intro}
      {filter && open > 0 && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          Showing {filterName} only.
          <button type="button" className={cn(TEXT_LINK, PHONE_HIT_AREA, "cursor-pointer")} onClick={onClearFilter}>
            Show all
          </button>
        </p>
      )}
      {slots > 0 && <SlotTray slots={slots} adds={adds} onTakeOut={undo} />}
      {body}
      {asOf && open > 0 && <p className="text-xs text-muted-foreground">Prices are Scryfall estimates from {formatAsOf(asOf)}.</p>}
      {view === "list" && (
        <NextBar label="Next: replace weaker cards" onNext={toReplace}>
          {open === 0 ? "Deck full" : `${open} slot${open === 1 ? "" : "s"} open`}
        </NextBar>
      )}
    </div>
  );
}
