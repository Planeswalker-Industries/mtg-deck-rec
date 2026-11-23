"use client";

import { useId, useRef, useState } from "react";
import type { Route } from "next";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { Popover } from "radix-ui";
import type { CardSummary, DeckBudget, IsoDateTime } from "@mtg/core/contract";
import type { ShoppingLine } from "@mtg/core/shop";
import { cn } from "cn";
import { PriceTag } from "@/components/cards/buy-price";
import { CardPlate } from "@/components/cards/card-plate";
import { BuyButtons, type RoundBuy } from "@/components/decks/buy-buttons";
import { TIP_HOVER_DELAY_MS } from "@/lib/constants";
import { asOfSuffix, formatUsd } from "@/lib/format";
import { BudgetFields } from "../start-settings";
import { Mark } from "./level";

/**
 * The round's money (T091), for the Deck stats footer and the sheet's Budget row. Its total is the round's cart total
 * (T102), the number Finish's shopping list shows and Buy sends, so the two never disagree.
 */
export interface RoundBudget {
  /** The cart total: every line the shopping list holds now (`cartTotal`). */
  totalUsd: number;
  /** The newest price date among those lines. */
  asOf: IsoDateTime | null;
  /** The cart's lines, the cards that total is on. */
  lines: readonly ShoppingLine[];
  budget: DeckBudget | undefined;
  /** Cards Add left out under the budget for having no price; absent without a budget. */
  unpricedSkipped?: number | undefined;
  onBudget: (budget: DeckBudget | undefined) => void;
  /** The collection import, offered beside a $0 spend; null when the player has a collection. */
  importHref: Route | null;
  /** The Buy button; absent outside a round. */
  buy?: RoundBuy | null;
}

/** Whether the cart costs more than the budget allows: only after the player lowered it. */
export const overBudget = ({ totalUsd, budget }: Pick<RoundBudget, "totalUsd" | "budget">) =>
  budget?.spendUsd !== undefined && totalUsd > budget.spendUsd;

/**
 * The footer's money slot: "$23/$50" with a spend budget, "$23" without one, nothing while the cart is empty. Amber
 * with ⚠ once the cart passes the budget; it moves only when the cart changes, never for the card on screen. The prices'
 * date is in its accessible name only: the docked bar has no room for it, and the sheet's Budget line shows it.
 */
export function MoneySlot({ money }: { money: RoundBudget }) {
  const { totalUsd, asOf, budget } = money;
  if (totalUsd <= 0) return <span />;
  const over = overBudget(money);
  return (
    <span className={over ? "inline-flex items-center gap-1 font-mono text-sm text-warning" : "font-mono text-sm"}>
      {over && <TriangleAlert aria-hidden className="size-4" />}
      <span className="sr-only">To buy </span>
      {formatUsd(totalUsd)}
      {budget?.spendUsd !== undefined && (
        <>
          <span className="sr-only"> of </span>
          <span aria-hidden>/</span>
          {formatUsd(budget.spendUsd)}
        </>
      )}
      <span className="sr-only">{asOfSuffix(asOf)}</span>
      {over && <span className="sr-only">, over budget</span>}
    </span>
  );
}

/**
 * Whether a card taken already costs more than the Max per card (T099): only after the player lowered it, or a build's
 * pick priced up since. It stays in the deck; the list marks it amber. An unpriced card is never over.
 */
const overCap = (card: CardSummary, budget: DeckBudget | undefined) =>
  budget?.cardCapUsd !== undefined && card.price != null && card.price.usd > budget.cardCapUsd;

/** The over-cap tip, the same words for the eye and the screen reader. */
const OVER_CAP_TIP = "Over card budget!";

/**
 * The over-cap mark: the warning icon alone, the price beside it amber (owner, 2026-11-19: less is more). The icon
 * opens its tip on a tap or a click, or while a mouse rests on it, as the Deck stats chips do; a screen reader hears
 * the tip as the button's name.
 */
function OverCapMark() {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        aria-label={OVER_CAP_TIP}
        // Stops here: the plate around it must not take the tap as its own.
        onClick={(e) => e.stopPropagation()}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          clear();
          timer.current = window.setTimeout(() => setOpen(true), TIP_HOVER_DELAY_MS);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          clear();
          setOpen(false);
        }}
        className={cn(
          "relative inline-flex cursor-pointer items-center rounded-sm text-warning",
          // A taller target for a thumb without making the plate taller.
          "after:absolute after:-inset-3 after:content-['']",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        )}
      >
        <TriangleAlert aria-hidden className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={16}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 max-w-64 rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm text-foreground shadow-lift"
        >
          {OVER_CAP_TIP}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The sheet's Budget row: its mark (off once over budget), the cart total against the budget with its prices' date, cards
 * left out unpriced, and the two fields to edit. Tapping "Budget" lists the cart's cards, each with its price, as slim
 * plates that enlarge when pressed; one over the Max per card is marked amber, never taken out. Buy on TCGplayer
 * sits beside it, so the player can check out at any step.
 */
export function BudgetRow({ money }: { money: RoundBudget }) {
  const { totalUsd, asOf, lines, budget, unpricedSkipped, onBudget, importHref, buy } = money;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const spend = budget?.spendUsd;
  const over = overBudget(money);
  const expandable = lines.length > 0;
  return (
    <section className="flex flex-col gap-2" aria-label="Budget">
      <div className="flex items-start justify-between gap-3">
        {expandable ? (
          <h3 className="text-sm font-semibold">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={open ? listId : undefined}
              onClick={() => setOpen((o) => !o)}
              className="-my-2 flex min-h-11 cursor-pointer items-center gap-1 rounded-md text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Budget
              <ChevronDown aria-hidden className={cn("size-4 transition-transform", !open && "-rotate-90")} />
              <span className="sr-only">{open ? ": hide the cards" : `: show the ${lines.length} cards`}</span>
            </button>
          </h3>
        ) : (
          <h3 className="text-sm font-semibold text-muted-foreground">Budget</h3>
        )}
        {buy && <BuyButtons carts={buy.carts} onBuy={buy.onBuy} saved={buy.saved} align="end" />}
      </div>
      <p className="flex items-center gap-2 text-sm">
        <Mark state={over ? "off" : "ok"} />
        <span>
          <span className="sr-only">To buy </span>
          <span className="font-mono">{formatUsd(totalUsd)}</span>
          {spend !== undefined && (
            <>
              {" "}
              of <span className="font-mono">{formatUsd(spend)}</span>
            </>
          )}
          {asOf && <span className="text-xs text-muted-foreground">{asOfSuffix(asOf)}</span>}
        </span>
        {over ? (
          <span className="ml-auto shrink-0 text-xs text-destructive">Over budget</span>
        ) : (
          spend !== undefined && totalUsd >= spend && <span className="ml-auto shrink-0 text-xs text-muted-foreground">Budget spent</span>
        )}
      </p>
      {open && expandable && (
        <ul id={listId} aria-label="Cards to buy" className="flex flex-col gap-1">
          {lines.map(({ card, quantity }) => (
            <CardPlate
              key={card.id}
              card={card}
              quantity={quantity}
              showCost={false}
              slim
              trailing={
                overCap(card, budget) ? (
                  <span className="mx-1 inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
                    <OverCapMark />
                    <PriceTag price={card.price} className="text-warning" />
                  </span>
                ) : (
                  <PriceTag price={card.price} className="mx-1 text-xs whitespace-nowrap" />
                )
              }
            />
          ))}
        </ul>
      )}
      {unpricedSkipped !== undefined && unpricedSkipped > 0 && (
        <p className="text-sm text-muted-foreground">
          {unpricedSkipped} card{unpricedSkipped === 1 ? "" : "s"} without a price left out
        </p>
      )}
      <BudgetFields budget={budget} onBudget={onBudget} importHref={importHref} />
    </section>
  );
}
