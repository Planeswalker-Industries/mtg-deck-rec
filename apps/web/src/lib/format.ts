import type { CostDelta, PriceEstimate } from "@mtg/core/contract";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function formatUsd(value: number): string {
  return usd.format(value);
}

/** "+$1.20", "−$0.40", "$0.00" */
export function formatUsdDelta(value: number): string {
  if (value === 0) return usd.format(0);
  return `${value > 0 ? "+" : "−"}${usd.format(Math.abs(value))}`;
}

/**
 * One card's price: "$1.10" (the lowest-priced printing's estimate; /privacy says so) or "No price". No "~":
 * it reads as a minus in DM Mono (owner, 2026-11-18). `lower` for mid-sentence use ("Not owned · $1.10", "Not owned ·
 * no price"). A single card's price carries no date; totals do (`asOfSuffix`), and `PriceTag` opens it on a tap.
 */
export function fromPrice(price: PriceEstimate | null | undefined, { lower = false }: { lower?: boolean } = {}): string {
  const text = price ? usd.format(price.usd) : "No price";
  return lower ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

export function formatAsOf(iso: string): string {
  return shortDate.format(new Date(iso));
}

/**
 * " (Nov 14, 2026)", or "" without a date. Prices carry their as-of date on the price or total itself, not on a note
 * line (owner, 2026-11-16); where they come from is on /privacy.
 */
export function asOfSuffix(iso: string | null | undefined): string {
  return iso ? ` (${formatAsOf(iso)})` : "";
}

export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function describeCostDelta(delta: CostDelta): string {
  switch (delta.basis) {
    case "price_unavailable":
      return "No price";
    case "both_owned":
      return "You own both";
    case "owned_replacement":
      return delta.usd === null ? "You own this" : `Owned · saves ${formatUsd(Math.abs(delta.usd))}`;
    case "buy_replacement_vs_buy_target":
      return delta.usd === null ? "No price" : formatUsdDelta(delta.usd);
  }
}
