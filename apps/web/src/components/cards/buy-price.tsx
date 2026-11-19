"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import type { PriceEstimate } from "@mtg/core/contract";
import { cn } from "cn";
import { formatAsOf, formatUsd } from "@/lib/format";

/** A white dotted underline: this number is an estimate, and tapping it says from when. */
const ESTIMATE_UNDERLINE = "underline decoration-foreground/60 decoration-dotted decoration-2 underline-offset-4";

/**
 * One card's price as "$4.29": no "~", which reads as a minus in DM Mono (owner, 2026-11-18). A white dotted underline
 * marks it as an estimate, and a tap or click opens its as-of date. `interactive={false}` where the price sits inside
 * something pressable (a pocket that adds its card): plain text, no underline, the date said elsewhere. `lower` writes
 * "no price" for mid-sentence use.
 */
export function PriceTag({
  price,
  className,
  interactive = true,
  lower = false,
}: {
  price: PriceEstimate | null | undefined;
  className?: string;
  interactive?: boolean;
  lower?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!price) return <span className={cn("font-mono", className)}>{lower ? "no price" : "No price"}</span>;
  if (!interactive) return <span className={cn("font-mono", className)}>{formatUsd(price.usd)}</span>;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        // Stops here: a plate or card around the price must not take the tap as its own.
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "cursor-pointer font-mono",
          ESTIMATE_UNDERLINE,
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          className,
        )}
      >
        {formatUsd(price.usd)}
        <span className="sr-only">, estimated price</span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={16}
          // Focus stays where it was, so the swipe keys keep working.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-50 max-w-64 rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm text-foreground shadow-lift"
        >
          Estimated price, {formatAsOf(price.asOf)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * The price of a card the round suggests buying, centred under its art (Swap): a step larger than the facts beside it
 * so it gets noticed, never larger than the card's name.
 */
export function BuyPrice({ price, className }: { price: PriceEstimate | null | undefined; className?: string }) {
  return (
    <p className={cn("text-center text-sm", className)}>
      <PriceTag price={price} className={price ? "text-foreground" : "text-muted-foreground"} />
    </p>
  );
}
