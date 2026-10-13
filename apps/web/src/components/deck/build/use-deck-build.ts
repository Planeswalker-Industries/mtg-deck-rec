"use client";

import { useRef, useState } from "react";
import type { Bracket, BuildResult, CardId, CardSummary, DeckCardEntry, OwnershipInput } from "@mtg/core/contract";
import { decklistFor } from "@mtg/core/journey";
import { getApis } from "@/lib/api/client";
import { defaultIncludeGameChangers } from "@/lib/labels";

/**
 * What to build: the commanders and the bracket, and, when fitting a pasted list to the collection, the list
 * itself (to show what changed) and the cards of it the collection holds, which the build keeps.
 */
export interface BuildRequest {
  commanders: CardSummary[];
  bracket: Bracket;
  /** Cards the build keeps: the list's owned cards and its basic lands. */
  kept?: DeckCardEntry[];
  /** The list being fitted, by card: its main cards and their copies, with the cards to name and show them. */
  list?: { entries: DeckCardEntry[]; cards: ReadonlyMap<CardId, CardSummary> };
}

export type BuildState =
  | { status: "idle" }
  | { status: "loading"; request: BuildRequest }
  | { status: "ready"; request: BuildRequest; result: BuildResult; fromCollection: boolean }
  | { status: "error"; request: BuildRequest; message: string };

/** The cards a build ends with, commanders apart: every picked card once, and the basic lands by count. */
export function buildEntries(result: BuildResult): DeckCardEntry[] {
  return [
    ...result.groups.flatMap((group) => group.cards.map((c) => ({ cardId: c.card.id, quantity: 1, section: "main" as const }))),
    ...result.basics.map((b) => ({ cardId: b.card.id, quantity: b.quantity, section: "main" as const })),
  ];
}

/** Every card a build names, commanders included, by id. */
export function buildCards(result: BuildResult): Map<CardId, CardSummary> {
  const cards = new Map<CardId, CardSummary>();
  for (const commander of result.commanderKey.commanders) cards.set(commander.id, commander);
  for (const group of result.groups) for (const c of group.cards) cards.set(c.card.id, c.card);
  for (const basic of result.basics) cards.set(basic.card.id, basic.card);
  return cards;
}

/** The decklist a build makes: its commanders, every picked card once, and the basic lands by count. */
export function buildDecklist(result: BuildResult): string {
  const cards = buildCards(result);
  return decklistFor(
    { commanders: result.commanderKey.commanders.map((c) => c.id), cards: buildEntries(result) },
    (id) => cards.get(id)?.name ?? null,
  );
}

/**
 * Builds a deck for a commander (`RecsApi.build`): from the collection's cards when there is one, from every card
 * when there isn't. Open slots stay open (`fill: 'none'`): the buy side is shelved. A newer build drops the
 * answer of an older one.
 */
export function useDeckBuild(ownership: OwnershipInput | null) {
  const [state, setState] = useState<BuildState>({ status: "idle" });
  const requestId = useRef(0);

  async function build(request: BuildRequest) {
    const id = ++requestId.current;
    setState({ status: "loading", request });
    const r = await getApis().recs.build({
      context: {
        deck: { commanders: request.commanders.map((c) => c.id), cards: request.kept ?? [] },
        bracket: request.bracket,
        bracketSource: "user",
        includeGameChangers: defaultIncludeGameChangers(request.bracket),
        ownership,
        ...(ownership ? { ownershipMode: "only" as const } : {}),
      },
      fill: "none",
    });
    if (id !== requestId.current) return;
    setState(
      r.ok
        ? { status: "ready", request, result: r.data, fromCollection: ownership !== null }
        : { status: "error", request, message: r.error.message },
    );
  }

  function reset() {
    requestId.current++;
    setState({ status: "idle" });
  }

  return { state, build, reset };
}
