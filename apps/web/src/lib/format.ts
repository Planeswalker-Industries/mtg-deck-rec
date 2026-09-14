import type { CostDelta } from "@mtg/core/contract";

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

export function formatAsOf(iso: string): string {
  return shortDate.format(new Date(iso));
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
