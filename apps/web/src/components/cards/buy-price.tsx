import type { PriceEstimate } from "@mtg/core/contract";
import { cn } from "cn";
import { fromPrice } from "@/lib/format";

/**
 * The price of a card the round suggests buying: "~$4.29", no as-of date (owner, 2026-11-18; the date stays on totals
 * and on the card page). A step larger than the facts beside it so it gets noticed, never larger than the card's name.
 */
export function BuyPrice({ price, className }: { price: PriceEstimate | null | undefined; className?: string }) {
  return <p className={cn("font-mono text-sm text-foreground", className)}>{fromPrice(price)}</p>;
}
