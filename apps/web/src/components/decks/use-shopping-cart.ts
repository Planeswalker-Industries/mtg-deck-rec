"use client";

import { useMemo, useState } from "react";
import type { CardId, IsoDateTime } from "@mtg/core/contract";
import { cartLines, cartTotal, shoppingList, type ShoppingLine, type ShoppingList } from "@mtg/core/shop";
import { cartLinks } from "@/lib/affiliate";

export type CartScope = "round" | "deck";

/**
 * The cart for one deck (T102): the shopping list, its TCGplayer carts and its total, with the scope and the lines the
 * player removed. One value per deck view, so every surface that shows a total (the docked Deck stats bar, the Budget
 * line, the list's heading, Finish's top block) reads the same number as Buy sends.
 */
export interface ShoppingCart {
  /** Null while the collection is being checked. */
  list: ShoppingList | null;
  /** The list's lines in list order, every group's; empty while the collection is checked. */
  lines: readonly ShoppingLine[];
  /** Mass Entry carts for the list's lines; empty when there is nothing to buy. */
  carts: string[];
  /** The cart total (`cartTotal`): every line of every cart. 0 while the collection is checked. */
  totalUsd: number;
  /** The newest price date among the lines. */
  asOf: IsoDateTime | null;
  /** Whether the lines are the copies a collection doesn't supply. */
  fromCollection: boolean;
  /** Whether the player may pick "This round's cards | Whole deck" (only without a collection). */
  scopeToggle: boolean;
  scope: CartScope;
  setScope: (scope: CartScope) => void;
  /** Lines taken out of this view, in the order removed (never touches the collection). */
  removed: readonly CardId[];
  /** The line removed last, for the Undo toast. */
  lastRemoved: ShoppingLine | undefined;
  remove: (id: CardId) => void;
  /** Puts the line removed last back. */
  undo: () => void;
}

export interface ShoppingCartInput {
  /** The deck as it stands, commanders included. */
  entries: readonly ShoppingLine[];
  /** Copies the collection doesn't supply; null without a collection; undefined while it is being checked. */
  missing: ReadonlyMap<CardId, number> | null | undefined;
  /** Cards the round put in, best first; empty where there is no round. */
  roundIds: readonly CardId[];
  /** Offer "This round's cards | Whole deck" (only without a collection). */
  scopeToggle: boolean;
  /** The scope before the player picks one; else this round's cards, or the whole deck when the round put none in. */
  defaultScope?: CartScope;
  /** A new value (a new round, another deck) clears the removed lines and the picked scope. */
  resetKey?: string | number | null;
}

const NO_REMOVALS: readonly CardId[] = [];

export function useShoppingCart({
  entries,
  missing,
  roundIds,
  scopeToggle,
  defaultScope,
  resetKey = null,
}: ShoppingCartInput): ShoppingCart {
  const [picked, setPicked] = useState<CartScope | null>(null);
  const [removed, setRemoved] = useState<readonly CardId[]>(NO_REMOVALS);
  const [keyFor, setKeyFor] = useState(resetKey);
  if (keyFor !== resetKey) {
    setKeyFor(resetKey);
    setPicked(null);
    setRemoved(NO_REMOVALS);
  }
  // Keyed on content, so a caller that builds a fresh array each render doesn't rebuild the list.
  const roundKey = roundIds.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRoundIds = useMemo(() => roundIds, [roundKey]);
  // Until the player picks, the scope follows the round: a round that put nothing in has nothing to buy in round scope.
  const scope: CartScope = picked ?? defaultScope ?? (stableRoundIds.length > 0 ? "round" : "deck");

  const list = useMemo(() => {
    if (missing === undefined) return null;
    const gone = new Set(removed);
    return shoppingList({
      entries: entries.filter((e) => !gone.has(e.card.id)),
      missing,
      roundIds: stableRoundIds,
      scope: scopeToggle ? scope : "deck",
    });
  }, [entries, missing, stableRoundIds, scope, scopeToggle, removed]);
  const lines = useMemo(() => list?.groups.flatMap((g) => g.lines) ?? [], [list]);
  const carts = useMemo(() => (list ? cartLinks(cartLines(list)) : []), [list]);
  const lastId = removed[removed.length - 1];

  return {
    list,
    lines,
    carts,
    totalUsd: list ? cartTotal(list) : 0,
    asOf: list?.asOf ?? null,
    fromCollection: missing !== null && missing !== undefined,
    scopeToggle,
    scope,
    setScope: setPicked,
    removed,
    lastRemoved: lastId === undefined ? undefined : entries.find((e) => e.card.id === lastId),
    remove: (id) => setRemoved((r) => [...r, id]),
    undo: () => setRemoved((r) => r.slice(0, -1)),
  };
}
