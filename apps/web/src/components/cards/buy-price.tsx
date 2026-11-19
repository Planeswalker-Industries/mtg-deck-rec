"use client";

import { useState } from "react";
import { Popover } from "radix-ui";
import type { PriceEstimate } from "@mtg/core/contract";
import { cn } from "cn";
import { formatAsOf, formatUsd } from "@/lib/format";

/**
 * The price of a card the round suggests buying, under its art: "$4.29" with no "~", which reads as a minus in DM Mono
 * (owner, 2026-11-18), centred under the art. A white dotted underline marks it as an estimate; a tap or click opens its as-of date. A step
 * larger than the facts beside it so it gets noticed, never larger than the card's name.
 */
export function BuyPrice({ price, className }: { price: PriceEstimate | null | undefined; className?: string }) {
  const [open, setOpen] = useState(false);
  if (!price) return <p className={cn("text-center text-sm text-muted-foreground", className)}>No price</p>;
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        className={cn(
          "mx-auto block cursor-pointer font-mono text-sm text-foreground underline decoration-foreground/60 decoration-dotted decoration-2 underline-offset-4",
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
