"use client";

import { useRef, useState } from "react";
import type { CardId, CardSummary, DeckInput, RecContext } from "@mtg/core/contract";
import { addCard, deckSize, makeCommander, removeCard, setQuantity, swapCard } from "@mtg/core/journey";
import { groupDeck, type DeckEntry } from "@mtg/core/scoring";
import { getApis } from "@/lib/api/client";
import type { SwapState } from "@/components/deck/use-deck-tool";

/**
 * The deck being built: its cards, the edits, and the replacement sheet. Persistence and analysis belong to whoever
 * hosts the builder (the saved deck's edit page writes to the account; the deck tool writes to its decklist), so every
 * edit is reported through `onChange` and nothing is saved here.
 */
export function useDeckBuilder({
  initialDeck,
  initialCards,
  onChange,
}: {
  initialDeck: DeckInput;
  initialCards: readonly CardSummary[];
  onChange: (deck: DeckInput, cards: ReadonlyMap<CardId, CardSummary>) => void;
}) {
  const [deck, setDeck] = useState(initialDeck);
  const [cards, setCards] = useState<ReadonlyMap<CardId, CardSummary>>(() => new Map(initialCards.map((c) => [c.id, c])));
  const [swap, setSwap] = useState<SwapState | null>(null);
  const swapRequest = useRef(0);

  function apply(next: DeckInput, ...seen: CardSummary[]) {
    if (next === deck) return;
    const known = seen.length === 0 ? cards : new Map([...cards, ...seen.map((c) => [c.id, c] as const)]);
    setDeck(next);
    if (known !== cards) setCards(known);
    onChange(next, known);
  }

  const main: DeckEntry[] = deck.cards.flatMap((c) => {
    const card = c.section === "main" ? cards.get(c.cardId) : undefined;
    return card ? [{ card, quantity: c.quantity }] : [];
  });
  const commanders = deck.commanders.flatMap((id) => {
    const card = cards.get(id);
    return card ? [card] : [];
  });

  /** Replacements for a card, against the deck as it stands. `context` supplies the bracket and Game Changer choice. */
  async function openSwap(target: CardSummary, context: RecContext) {
    const id = ++swapRequest.current;
    setSwap({ targetCardId: target.id, result: { status: "loading" } });
    const r = await getApis().recs.swap({ context: { ...context, deck }, targetCardId: target.id });
    if (id !== swapRequest.current) return;
    setSwap({ targetCardId: target.id, result: r.ok ? { status: "ready", data: r.data } : { status: "error", message: r.error.message } });
  }

  function closeSwap() {
    swapRequest.current++;
    setSwap(null);
  }

  return {
    deck,
    cards,
    commanders,
    main,
    groups: groupDeck(main, "type"),
    size: deckSize(deck),
    add: (card: CardSummary) => apply(addCard(deck, card), card),
    setQuantity: (card: CardSummary, quantity: number) => apply(setQuantity(deck, card, quantity)),
    remove: (card: CardSummary) => apply(removeCard(deck, card.id)),
    makeCommander: (card: CardSummary, mode: "replace" | "partner") => apply(makeCommander(deck, card, mode), card),
    swapIn: (target: CardSummary, replacement: CardSummary) => {
      apply(swapCard(deck, target, replacement), replacement);
      closeSwap();
    },
    swap,
    openSwap,
    closeSwap,
  };
}

export type DeckBuilderState = ReturnType<typeof useDeckBuilder>;
