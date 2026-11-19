"use client";

import { useId, useState } from "react";
import type { Route } from "next";
import Link from "next/link";
import { ChevronDown, TriangleAlert } from "lucide-react";
import type { CardId, CardSummary, DeckBudget } from "@mtg/core/contract";
import { cn } from "cn";
import { PriceTag } from "@/components/cards/buy-price";
import { CardPlate } from "@/components/cards/card-plate";
import { buttonVariants } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { affiliateOn, OUTBOUND } from "@/lib/affiliate";
import { AFFILIATE_DISCLOSURE, TEXT_LINK } from "@/lib/constants";
import { formatUsd } from "@/lib/format";
import { BudgetFields } from "../start-settings";
import { Mark } from "./level";

/** Where the Buy button's deck went when it saved it for a signed-in player (or why it couldn't). */
export type BuySaveState =
  { status: "idle" } | { status: "saving" } | { status: "saved"; href: Route } | { status: "error"; message: string };

/** Buying from Deck stats (owner, 2026-11-18): the same carts as Finish's list, at any step of the round. */
export interface RoundBuy {
  /** Mass Entry carts; empty when there is nothing to buy. */
  carts: string[];
  /** Called as a cart opens: saves the deck to My Decks when the player is signed in. */
  onBuy: () => void;
  saved: BuySaveState;
}

/** The round's money (T091), for the Deck stats footer and the sheet's Budget row. */
export interface RoundBudget {
  /** What the round has spent on cards the player doesn't own. */
  spentUsd: number;
  /** The copies that spend is on, in the order taken (`roundBuys`). */
  buys: readonly CardSummary[];
  budget: DeckBudget | undefined;
  /** Cards Add left out under the budget for having no price; absent without a budget. */
  unpricedSkipped?: number | undefined;
  onBudget: (budget: DeckBudget | undefined) => void;
  /** The collection import, offered beside a $0 spend; null when the player has a collection. */
  importHref: Route | null;
  /** The Buy button; absent outside a round. */
  buy?: RoundBuy | null;
}

/** Whether the round spent more than the budget allows: only after the player lowered it. */
export const overBudget = ({ spentUsd, budget }: Pick<RoundBudget, "spentUsd" | "budget">) =>
  budget?.spendUsd !== undefined && spentUsd > budget.spendUsd;

/**
 * The footer's money slot: "$23/$50" with a spend budget, "$23" without one, nothing before the round spends. Amber
 * with ⚠ once the spend passes the budget; it moves only when a card is taken, never for the card on screen.
 */
export function MoneySlot({ money }: { money: RoundBudget }) {
  const { spentUsd, budget } = money;
  if (spentUsd <= 0) return <span />;
  const over = overBudget(money);
  return (
    <span className={over ? "inline-flex items-center gap-1 font-mono text-sm text-warning" : "font-mono text-sm"}>
      {over && <TriangleAlert aria-hidden className="size-4" />}
      <span className="sr-only">Spent </span>
      {formatUsd(spentUsd)}
      {budget?.spendUsd !== undefined && (
        <>
          <span className="sr-only"> of </span>
          <span aria-hidden>/</span>
          {formatUsd(budget.spendUsd)}
        </>
      )}
      {over && <span className="sr-only">, over budget</span>}
    </span>
  );
}

/** The bought copies as one line per card, in the order first taken. */
function countedBuys(buys: readonly CardSummary[]): { card: CardSummary; quantity: number }[] {
  const byId = new Map<CardId, { card: CardSummary; quantity: number }>();
  for (const card of buys) byId.set(card.id, { card, quantity: (byId.get(card.id)?.quantity ?? 0) + 1 });
  return [...byId.values()];
}

/** Buy on TCGplayer from Deck stats, with what became of the autosave under it. */
function BuyButtons({ buy }: { buy: RoundBuy }) {
  const { carts, onBuy, saved } = buy;
  if (carts.length === 0) return null;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {/* A named primary action, as on Finish: the solid blue button. */}
        {carts.map((href, i) => (
          <a key={href} href={href} {...OUTBOUND} onClick={onBuy} className={cn(buttonVariants({ size: "sm" }), "lit")}>
            {carts.length > 1 ? `Buy on TCGplayer (${i + 1} of ${carts.length})` : "Buy on TCGplayer"}
          </a>
        ))}
      </div>
      {saved.status === "saving" && (
        <p role="status" className="text-xs text-muted-foreground">
          Saving to My Decks…
        </p>
      )}
      {saved.status === "saved" && (
        <p role="status" className="text-xs text-muted-foreground">
          Saved to{" "}
          <Link href={saved.href} className={TEXT_LINK}>
            My Decks
          </Link>
        </p>
      )}
      {saved.status === "error" && <ErrorText>{`Not saved: ${saved.message}`}</ErrorText>}
    </div>
  );
}

/**
 * The sheet's Budget row: its mark (off once over budget), what the round spent against the budget, cards left out
 * unpriced, and the two fields to edit. Tapping "Budget" lists the cards the spend is on, each with its price, as slim
 * plates that enlarge when pressed. Buy on TCGplayer sits beside it, so the player can check out at any step.
 */
export function BudgetRow({ money }: { money: RoundBudget }) {
  const { spentUsd, buys, budget, unpricedSkipped, onBudget, importHref, buy } = money;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const spend = budget?.spendUsd;
  const over = overBudget(money);
  const lines = countedBuys(buys);
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
        {buy && <BuyButtons buy={buy} />}
      </div>
      <p className="flex items-center gap-2 text-sm">
        <Mark state={over ? "off" : "ok"} />
        <span>
          <span className="sr-only">Spent </span>
          <span className="font-mono">{formatUsd(spentUsd)}</span>
          {spend !== undefined && (
            <>
              {" "}
              of <span className="font-mono">{formatUsd(spend)}</span>
            </>
          )}
        </span>
        {over ? (
          <span className="ml-auto shrink-0 text-xs text-destructive">Over budget</span>
        ) : (
          spend !== undefined && spentUsd >= spend && <span className="ml-auto shrink-0 text-xs text-muted-foreground">Budget spent</span>
        )}
      </p>
      {open && expandable && (
        <ul id={listId} aria-label="Cards the budget is spent on" className="flex flex-col gap-1">
          {lines.map(({ card, quantity }) => (
            <CardPlate
              key={card.id}
              card={card}
              quantity={quantity}
              showCost={false}
              slim
              trailing={<PriceTag price={card.price} className="mx-1 text-xs whitespace-nowrap" />}
            />
          ))}
        </ul>
      )}
      {buy && buy.carts.length > 0 && affiliateOn() && <p className="text-xs text-muted-foreground">{AFFILIATE_DISCLOSURE}</p>}
      {unpricedSkipped !== undefined && unpricedSkipped > 0 && (
        <p className="text-sm text-muted-foreground">
          {unpricedSkipped} card{unpricedSkipped === 1 ? "" : "s"} without a price left out
        </p>
      )}
      <BudgetFields budget={budget} onBudget={onBudget} importHref={importHref} />
    </section>
  );
}
