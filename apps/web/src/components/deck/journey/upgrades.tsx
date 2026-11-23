"use client";

import { useEffect, useMemo, useState } from "react";
import type { RecContext, UpgradeSuggestion } from "@mtg/core/contract";
import { cartLines, shoppingList } from "@mtg/core/shop";
import { cn } from "cn";
import { BuyButtons, type BuySaveState } from "@/components/decks/buy-buttons";
import { CardPlate } from "@/components/cards/card-plate";
import { PriceTag } from "@/components/cards/buy-price";
import { cartLinks } from "@/lib/affiliate";
import { getApis } from "@/lib/api/client";
import { asOfSuffix, formatUsd } from "@/lib/format";

/**
 * Upgrades worth buying (T102): for a deck the collection fully supplies, the unowned cards that would improve it most,
 * each beside the deck card it replaces, with one Buy for all of them. Read once when Finish opens (the deck doesn't
 * change on Finish). Renders nothing while loading, on a failure, or when nothing beats what the collection holds: an
 * upgrade is an offer, never a gap to explain.
 */
export function Upgrades({
  context,
  onBuy,
  saved,
  className,
}: {
  /** The round's context, the deck as it stands: collection, bracket, budget left and stat choices. */
  context: RecContext;
  /** Called as the cart opens: saves the deck as it stands (without the upgrades) for a signed-in player. */
  onBuy: () => void;
  saved: BuySaveState;
  className?: string;
}) {
  const [upgrades, setUpgrades] = useState<UpgradeSuggestion[]>([]);
  useEffect(() => {
    let live = true;
    void getApis()
      .recs.upgrades({ context })
      .then((r) => {
        if (live && r.ok) setUpgrades(r.data.suggestions);
      });
    return () => {
      live = false;
    };
    // Once per Finish: the deck it was read for is the one on screen until Finish closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The upgrades as a shopping list, so their total and carts are counted as every other cart is.
  const list = useMemo(
    () => shoppingList({ entries: upgrades.map((u) => ({ card: u.card, quantity: 1 })), missing: null, roundIds: [], scope: "deck" }),
    [upgrades],
  );
  const carts = useMemo(() => cartLinks(cartLines(list)), [list]);
  if (upgrades.length === 0) return null;

  return (
    <section aria-labelledby="review-upgrades" className={cn("flex flex-col gap-3", className)}>
      <h3 id="review-upgrades" className="font-heading text-xl leading-none font-semibold">
        Upgrades worth buying
      </h3>
      {/*
        Out beside In, as Changes lays a swap out: the deck card on the left, the card to buy for it on the right. The
        plates are one height, so each pair sits on one row.
      */}
      <div className="grid grid-cols-2 items-start gap-x-3">
        <section aria-label="Out" className="flex flex-col gap-1.5">
          <h4 aria-hidden className="text-xs font-semibold text-cut">Out</h4>
          <ul className="flex flex-col gap-1.5">
            {upgrades.map((u) => (
              <CardPlate key={u.target.id} card={u.target} quantity={1} mark="cut" showCost={false} slim />
            ))}
          </ul>
        </section>
        <section aria-label="In" className="flex flex-col gap-1.5">
          <h4 aria-hidden className="text-xs font-semibold text-add">In</h4>
          <ul aria-label="Upgrades" className="flex flex-col gap-1.5">
            {upgrades.map((u) => (
              <CardPlate
                key={u.card.id}
                card={u.card}
                quantity={1}
                mark="add"
                showCost={false}
                slim
                trailing={<PriceTag price={u.card.price} className="text-sm" />}
              />
            ))}
          </ul>
        </section>
      </div>
      <p className="text-sm">
        {list.count.toLocaleString("en-US")} {list.count === 1 ? "card" : "cards"},{" "}
        <span className="font-mono">{formatUsd(list.totalUsd)}</span>
        <span className="text-xs text-muted-foreground">{asOfSuffix(list.asOf)}</span>
        {list.unpriced > 0 && <span className="text-muted-foreground"> · {list.unpriced} unpriced</span>}
      </p>
      <BuyButtons carts={carts} onBuy={onBuy} saved={saved} seal className="max-sm:items-stretch max-sm:[&_a]:flex-1" />
    </section>
  );
}
