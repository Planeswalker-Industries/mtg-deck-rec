"use client";

import type { Route } from "next";
import { TriangleAlert } from "lucide-react";
import type { DeckBudget } from "@mtg/core/contract";
import { formatUsd } from "@/lib/format";
import { BudgetFields } from "../start-settings";
import { Mark } from "./level";

/** The round's money (T091), for the Deck stats footer and the sheet's Budget row. */
export interface RoundBudget {
  /** What the round has spent on cards the player doesn't own. */
  spentUsd: number;
  budget: DeckBudget | undefined;
  /** Cards Add left out under the budget for having no price; absent without a budget. */
  unpricedSkipped?: number | undefined;
  onBudget: (budget: DeckBudget | undefined) => void;
  /** The collection import, offered beside a $0 spend; null when the player has a collection. */
  importHref: Route | null;
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

/**
 * The sheet's Budget row: its mark (off once over budget), what the round spent against the budget, cards left out
 * unpriced, and the two fields to edit.
 */
export function BudgetRow({ money }: { money: RoundBudget }) {
  const { spentUsd, budget, unpricedSkipped, onBudget, importHref } = money;
  const spend = budget?.spendUsd;
  const over = overBudget(money);
  return (
    <section className="flex flex-col gap-2" aria-label="Budget">
      <h3 className="text-sm font-semibold text-muted-foreground">Budget</h3>
      <p className="flex items-center gap-2 text-sm">
        <Mark state={over ? "off" : "ok"} />
        <span>
          Spent <span className="font-mono">{formatUsd(spentUsd)}</span>
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
      {unpricedSkipped !== undefined && unpricedSkipped > 0 && (
        <p className="text-sm text-muted-foreground">
          {unpricedSkipped} card{unpricedSkipped === 1 ? "" : "s"} without a price left out
        </p>
      )}
      <BudgetFields budget={budget} onBudget={onBudget} importHref={importHref} />
    </section>
  );
}
