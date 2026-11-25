"use client";

import type { Route } from "next";
import Link from "next/link";
import { cn } from "cn";
import { buttonVariants } from "@/components/ui/button";
import { ErrorText } from "@/components/ui/error-text";
import { affiliateOn, OUTBOUND } from "@/lib/affiliate";
import { AFFILIATE_DISCLOSURE, SEAL_BUTTON, TEXT_LINK } from "@/lib/constants";
import { asOfSuffix, formatUsd } from "@/lib/format";
import type { ShoppingCart } from "./use-shopping-cart";

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

/**
 * Buy on TCGplayer (T102), the one button every Buy renders through: the built page, Finish, Deck stats and the saved
 * deck page. One button per cart ("Buy on TCGplayer (1 of 2)" when the cards need several), nothing at all when there is
 * nothing to buy (no greyed Buy), and under it what became of the save a signed-in press makes and the affiliate
 * disclosure, so every Buy carries it. Every button is at least
 * 44 px tall on phones. `seal` makes it the page's main action; otherwise it is the solid primary button.
 */
export function BuyButtons({
  carts,
  onBuy,
  saved = { status: "idle" },
  seal = false,
  label = "Buy on TCGplayer",
  align = "start",
  className,
  tour,
}: {
  carts: readonly string[];
  /** Called as a cart opens; absent where Buy saves nothing (the saved deck page). */
  onBuy?: () => void;
  saved?: BuySaveState;
  seal?: boolean;
  /** One cart's words (a split cart's buttons each say which cart they are). */
  label?: string;
  /** Which side the buttons and the save line sit on. */
  align?: "start" | "end";
  className?: string;
  /** The page's tour id: the buttons carry `<tour>.buy`. */
  tour?: string;
}) {
  if (carts.length === 0) return null;
  return (
    <div data-tour={tour && `${tour}.buy`} className={cn("flex flex-col gap-1", align === "end" ? "items-end" : "items-start", className)}>
      <div className={cn("flex flex-wrap gap-2", align === "end" && "justify-end")}>
        {carts.map((href, i) => (
          <a
            key={href}
            href={href}
            {...OUTBOUND}
            onClick={onBuy}
            className={seal ? SEAL_BUTTON : cn(buttonVariants({ size: "lg" }), "lit")}
          >
            {/* Split carts can't each carry the whole list. */}
            {carts.length > 1 ? `Buy on TCGplayer (${i + 1} of ${carts.length})` : label}
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
      {affiliateOn() && <p className="text-xs text-muted-foreground">{AFFILIATE_DISCLOSURE}</p>}
    </div>
  );
}

/**
 * The cart's total in one line, beside or above its Buy (T102): "12 cards to buy, $54.20 (Nov 16, 2026)", the same
 * number every other surface shows, written as they write it (no "~": it reads as a minus in DM Mono). `emptyText` stands in when there is nothing to buy; nothing renders while the
 * collection is checked.
 */
export function CartTotal({ cart, emptyText, className }: { cart: ShoppingCart; emptyText: string; className?: string }) {
  const list = cart.list;
  if (!list) return null;
  return (
    <p className={cn("text-sm", className)}>
      {list.count === 0 ? (
        emptyText
      ) : (
        <>
          {list.count.toLocaleString("en-US")} {list.count === 1 ? "card" : "cards"} to buy,{" "}
          <span className="font-mono">{formatUsd(cart.totalUsd)}</span>
          <span className="text-xs text-muted-foreground">{asOfSuffix(cart.asOf)}</span>
          {list.unpriced > 0 && <span className="text-muted-foreground"> · {list.unpriced} unpriced</span>}
        </>
      )}
    </p>
  );
}
