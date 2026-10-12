"use client";

import { useRef, useState } from "react";
import type { Bracket, BuildResult, CardId, CardSummary, OwnershipInput } from "@mtg/core/contract";
import { decklistFor } from "@mtg/core/journey";
import { getApis } from "@/lib/api/client";
import { defaultIncludeGameChangers } from "@/lib/labels";
import { BUILD_DEFAULT_BRACKET } from "@/lib/constants";

export type BuildState =
  | { status: "idle" }
  | { status: "loading"; commander: CardSummary; bracket: Bracket }
  | { status: "ready"; commander: CardSummary; bracket: Bracket; result: BuildResult; fromCollection: boolean }
  | { status: "error"; commander: CardSummary; bracket: Bracket; message: string };

/** The decklist a build makes: its commanders, every picked card once, and the basic lands by count. */
export function buildDecklist(result: BuildResult): string {
  const names = new Map<CardId, string>();
  for (const commander of result.commanderKey.commanders) names.set(commander.id, commander.name);
  const cards = result.groups.flatMap((group) => group.cards.map((c) => (names.set(c.card.id, c.card.name), { cardId: c.card.id, quantity: 1 })));
  for (const basic of result.basics) names.set(basic.card.id, basic.card.name);
  return decklistFor(
    {
      commanders: result.commanderKey.commanders.map((c) => c.id),
      cards: [...cards, ...result.basics.map((b) => ({ cardId: b.card.id, quantity: b.quantity }))].map((c) => ({ ...c, section: "main" as const })),
    },
    (id) => names.get(id) ?? null,
  );
}

/**
 * Builds a deck for one commander (`RecsApi.build`): from the collection's cards when there is one, from every card
 * when there isn't. Open slots stay open (`fill: 'none'`): the buy side is shelved (D-12). A newer build drops the
 * answer of an older one.
 */
export function useDeckBuild(ownership: OwnershipInput | null) {
  const [state, setState] = useState<BuildState>({ status: "idle" });
  const request = useRef(0);

  async function build(commander: CardSummary, bracket: Bracket = BUILD_DEFAULT_BRACKET) {
    const id = ++request.current;
    setState({ status: "loading", commander, bracket });
    const r = await getApis().recs.build({
      context: {
        deck: { commanders: [commander.id], cards: [] },
        bracket,
        bracketSource: "user",
        includeGameChangers: defaultIncludeGameChangers(bracket),
        ownership,
        ...(ownership ? { ownershipMode: "only" as const } : {}),
      },
      fill: "none",
    });
    if (id !== request.current) return;
    setState(
      r.ok
        ? { status: "ready", commander, bracket, result: r.data, fromCollection: ownership !== null }
        : { status: "error", commander, bracket, message: r.error.message },
    );
  }

  function reset() {
    request.current++;
    setState({ status: "idle" });
  }

  return { state, build, reset };
}
