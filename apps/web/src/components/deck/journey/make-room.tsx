"use client";

import { useState, type ReactNode } from "react";
import { Check, Scissors } from "lucide-react";
import type { CardId, CardSummary, CutResult } from "@mtg/core/contract";
import { roomCuts, roomNeeded, type StatLine } from "@mtg/core/journey";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PhaseIntro } from "./journey-stepper";
import { SingleSwipe, SwipeDone } from "./single-swipe";
import type { Async } from "../use-deck-tool";
import type { DeckJourney } from "./use-deck-journey";

/** The role the player wants more of, as Deck stats names it. */
export interface RoomFocus {
  roleId: string;
  label: string;
}

/** The value the role picker shows while no role is chosen. */
const NO_FOCUS = "none";

/**
 * "Make room for…": the player names an area the deck lacks, and Cut offers cards to cut for it (goal 4). The roles are
 * Deck stats' tracked roles, each with its count against the target.
 */
export function MakeRoomPicker({
  roles,
  focus,
  onChange,
}: {
  roles: readonly StatLine[];
  focus: RoomFocus | null;
  onChange: (focus: RoomFocus | null) => void;
}) {
  if (roles.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Feel short on something?</span>
      <Select
        value={focus?.roleId ?? NO_FOCUS}
        onValueChange={(value) => {
          const role = roles.find((r) => r.key === value);
          onChange(role ? { roleId: role.key, label: role.label } : null);
        }}
      >
        <SelectTrigger aria-label="Make room for" size="sm" className="bg-sleeve">
          <SelectValue>{focus ? `Make room for ${focus.label.toLowerCase()}` : "Make room for…"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {focus && <SelectItem value={NO_FOCUS}>Back to the usual cuts</SelectItem>}
          {roles.map((role) => (
            <SelectItem key={role.key} value={role.key}>
              {role.label} <span className="font-mono text-muted-foreground">{role.value} / {Math.round(role.target)}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Cut, making room for one role: cards that don't fill it, weakest first (`roomCuts`), dealt until the deck has cut as
 * many as the role is short of. Then Add opens narrowed to that role (`onFind`). Keeping a card only skips it here.
 */
export function MakeRoomCut({
  journey,
  cutState,
  cardRoles,
  roles,
  focus,
  view,
  onFind,
  picker,
}: {
  journey: DeckJourney;
  cutState: Extract<Async<CutResult>, { status: "ready" }>;
  /** The tracked role ids of each card in the analyzed deck. */
  cardRoles: Readonly<Record<number, readonly string[]>>;
  roles: readonly StatLine[];
  focus: RoomFocus;
  view: "swipe" | "list";
  onFind: () => void;
  /** The role picker, to change or drop the focus. */
  picker: ReactNode;
}) {
  const [spared, setSpared] = useState<ReadonlySet<CardId>>(new Set());
  const [cutHere, setCutHere] = useState(0);
  const deck = journey.deck;
  if (!deck) return null;

  const roomRoles = roles.map((r) => ({ roleId: r.key, value: r.value, target: r.target }));
  const needed = roomNeeded(roomRoles, focus.roleId);
  const cutScores = new Map(cutState.data.suggestions.map((s) => [s.card.id, s.cutScore]));
  const candidates = roomCuts({
    cards: deck.cards
      .filter((entry) => entry.section === "main")
      .flatMap((entry) => {
        const card = journey.cards.get(entry.cardId);
        return card ? [{ id: card.id, isLand: card.typeLine.includes("Land"), manaValue: card.manaValue, roles: cardRoles[card.id] ?? [] }] : [];
      }),
    focusRoleId: focus.roleId,
    roles: roomRoles,
    cutScores,
    spared,
  })
    .map((id) => journey.cards.get(id))
    .filter((card): card is CardSummary => card !== undefined);
  const reasons = new Map(cutState.data.suggestions.map((s) => [s.card.id as number, s.reasons]));
  const role = focus.label.toLowerCase();
  const focusLine = roles.find((r) => r.key === focus.roleId);
  const findButton = (
    <Button type="button" size="lg" onClick={onFind}>
      Next: find {role}
    </Button>
  );
  const explanation = `The deck runs ${focusLine?.value ?? 0} cards for ${role}; decks with this commander run about ${Math.round(focusLine?.target ?? 0)}. These cards don't do it, weakest first: cut ${needed}, then pick ${role} to put in.`;
  // Swipe view keeps its heading for screen readers only, like every phase: the phone's height is the cards'.
  const intro =
    view === "swipe" ? (
      <PhaseIntro title={`Make room for ${role}`} brief={`${explanation} Swipe right to cut, left to keep.`}>
        {explanation}
      </PhaseIntro>
    ) : (
      <PhaseIntro title={`Make room for ${role}`} aside="Let's find the cards that can go.">
        {explanation}
      </PhaseIntro>
    );

  if (view === "list") {
    return (
      <div className="flex flex-col gap-4">
        {intro}
        {picker}
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing obvious left to cut for this. Switch back to the usual cuts to pick any card.</p>
        ) : (
          <PocketGrid
            zoomable
            label={`Cards to cut to make room for ${role}`}
            onSelect={(card) => journey.cut.toggle(card)}
            items={candidates.map((card) => ({ card, ...(journey.cut.isMarked(card) ? { mark: "cut" as const } : {}) }))}
          />
        )}
        <div className="flex flex-wrap gap-2">{findButton}</div>
      </div>
    );
  }

  const next = cutHere < needed ? candidates[0] : undefined;
  return (
    <div className="flex flex-col gap-4">
      {intro}
      {next ? (
        <SingleSwipe
          card={next}
          position={cutHere + 1}
          total={needed}
          label={`Cards to cut to make room for ${role}`}
          tone="cut"
          acceptIcon={Scissors}
          passIcon={Check}
          acceptLabel={`Cut ${next.name}`}
          passLabel={`Keep ${next.name}`}
          caption={reasons.has(next.id) ? `Rarely played with this commander, and isn't ${role}.` : "Its job is one the deck already has plenty of."}
          onAccept={() => {
            journey.dispatch({ type: "cut", card: next });
            setCutHere((n) => n + 1);
          }}
          onPass={() => setSpared((s) => new Set([...s, next.id]))}
          footer={
            <Button type="button" size="sm" variant="link" onClick={onFind}>
              Find {role} now
            </Button>
          }
        />
      ) : (
        <SwipeDone
          message={
            cutHere > 0
              ? `${cutHere} card${cutHere === 1 ? "" : "s"} cut to make room for ${role}.`
              : `Nothing obvious left to cut for ${role}. Switch to the list to cut any card you want gone.`
          }
        >
          {findButton}
        </SwipeDone>
      )}
      {picker}
    </div>
  );
}
