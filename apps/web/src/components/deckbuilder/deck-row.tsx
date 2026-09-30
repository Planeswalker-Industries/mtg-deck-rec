"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { Crown, Minus, Plus, Repeat2, Trash2 } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { ManaCost } from "@/components/cards/mana-cost";
import { displayName } from "@/lib/cards";

/** The floating card shown beside a hovered row: the `normal` image's own width at half size, so it stays sharp. */
const PREVIEW_WIDTH_PX = 244;
/** Scryfall cards are 488×680; the preview keeps that shape. */
const PREVIEW_HEIGHT_PX = Math.round((PREVIEW_WIDTH_PX * 680) / 488);
/** Space between the row and the floating card, and between the card and the window edge. */
const PREVIEW_GAP_PX = 12;
/** A pointer passing over the list shouldn't flicker a card up for every row it crosses. */
const PREVIEW_DELAY_MS = 120;

/**
 * Where the preview goes: to the left of the row (the decklist is the right half, so the card lands over the search
 * side), or to its right when there is no room, and never past the top or bottom of the window.
 */
function previewPosition(row: DOMRect): { top: number; left: number } {
  const left = row.left - PREVIEW_WIDTH_PX - PREVIEW_GAP_PX >= PREVIEW_GAP_PX ? row.left - PREVIEW_WIDTH_PX - PREVIEW_GAP_PX : row.right + PREVIEW_GAP_PX;
  const centred = row.top + row.height / 2 - PREVIEW_HEIGHT_PX / 2;
  const top = Math.min(Math.max(centred, PREVIEW_GAP_PX), window.innerHeight - PREVIEW_HEIGHT_PX - PREVIEW_GAP_PX);
  return { top, left };
}

/** A round icon button on a row: grey at rest and dimmed until the row is pointed at; blue on hover, red for Remove. */
function RowButton({ label, onClick, tone, children }: { label: string; onClick: () => void; tone?: "cut"; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "relative flex size-8 items-center justify-center rounded-full text-muted-foreground transition-[opacity,color,background-color] duration-180 ease-table",
        "[@media(hover:hover)]:opacity-50 [@media(hover:hover)]:group-hover/row:opacity-100 focus-visible:opacity-100",
        // 44 px tall to a thumb without making the row taller.
        "after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        tone === "cut"
          ? "hover:bg-cut/15 hover:text-cut focus-visible:text-cut focus-visible:outline-cut"
          : "hover:bg-primary/15 hover:text-primary focus-visible:text-primary focus-visible:outline-primary",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One card in the decklist, as a strip: the name and its cost over the card's art, which fades in from the right, and
 * what can be done to it at the end. Pointing at the row (or focusing it) floats the whole card beside it; pressing
 * it enlarges the card.
 */
export function DeckRow({
  card,
  quantity,
  commander = false,
  onRemove,
  onQuantity,
  onReplace,
}: {
  card: CardSummary;
  quantity: number;
  commander?: boolean;
  onRemove: () => void;
  onQuantity?: ((quantity: number) => void) | undefined;
  onReplace?: (() => void) | undefined;
}) {
  const name = displayName(card);
  const art = card.images?.front.artCrop;
  const row = useRef<HTMLLIElement>(null);
  const timer = useRef<number | null>(null);
  const [preview, setPreview] = useState<{ top: number; left: number } | null>(null);

  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }

  function show(delay: number) {
    clearTimer();
    timer.current = window.setTimeout(() => {
      if (row.current) setPreview(previewPosition(row.current.getBoundingClientRect()));
    }, delay);
  }

  function hide() {
    clearTimer();
    setPreview(null);
  }

  // The card is placed once, where the row was; a scroll moves the row out from under it, so it goes.
  useEffect(() => {
    if (!preview) return;
    const close = () => setPreview(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [preview]);
  useEffect(() => clearTimer, []);

  return (
    <li
      ref={row}
      className="group/row relative grid h-12 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border border-seam bg-sleeve"
      onPointerEnter={(e) => e.pointerType === "mouse" && show(PREVIEW_DELAY_MS)}
      onPointerLeave={hide}
      onPointerDown={hide}
      // Keyboard users get the same preview when they reach the row, not when a click focuses one of its buttons.
      onFocus={(e) => e.target.matches(":focus-visible") && show(0)}
      onBlur={hide}
    >
      <ZoomableCard
        card={card}
        hover={false}
        // A row doesn't lift under the pointer like a loose card: the floating preview is its hover.
        className="relative flex h-full min-w-0 items-center gap-2 pr-2 pl-3 [@media(hover:hover)]:hover:translate-y-0"
      >
        {art && (
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-3/5 [mask-image:linear-gradient(to_right,transparent,black_55%)]">
            <Image src={art} alt="" fill unoptimized sizes="240px" className="object-cover object-[center_30%]" />
          </span>
        )}
        <span className="relative flex min-w-0 items-center gap-2 [text-shadow:0_1px_2px_rgb(0_0_0/0.9)]">
          {quantity > 1 && <span className="shrink-0 font-mono text-sm tabular-nums">{quantity}×</span>}
          <span className="truncate text-sm font-semibold">{name}</span>
          {commander && <Crown aria-label="Commander" className="size-4 shrink-0 text-foreground/80" />}
          <ManaCost cost={card.manaCost} className="text-sm" />
          {card.gameChanger && (
            <span title="Game Changer" className="shrink-0 rounded-sm bg-gc-bg px-1 font-mono text-xs text-gc">
              GC<span className="sr-only"> (Game Changer)</span>
            </span>
          )}
        </span>
      </ZoomableCard>
      <div className="flex items-center gap-0.5 border-l border-seam bg-sleeve px-1">
        {onQuantity && (
          <>
            <RowButton label={`One fewer ${name}`} onClick={() => onQuantity(quantity - 1)}>
              <Minus aria-hidden className="size-4" />
            </RowButton>
            <span className="min-w-6 text-center font-mono text-sm" aria-label={`${quantity} copies`}>
              {quantity}
            </span>
            <RowButton label={`One more ${name}`} onClick={() => onQuantity(quantity + 1)}>
              <Plus aria-hidden className="size-4" />
            </RowButton>
          </>
        )}
        {onReplace && (
          <RowButton label={`Replace ${name}`} onClick={onReplace}>
            <Repeat2 aria-hidden className="size-4" />
          </RowButton>
        )}
        <RowButton label={`Remove ${name}`} onClick={onRemove} tone="cut">
          <Trash2 aria-hidden className="size-4" />
        </RowButton>
      </div>
      {preview &&
        createPortal(
          <div
            aria-hidden
            className="pointer-events-none fixed z-60 rounded-[4.75%/3.5%] shadow-lift"
            style={{ top: preview.top, left: preview.left, width: PREVIEW_WIDTH_PX }}
          >
            <CardImage card={card} variant="normal" alt="" sizes={`${PREVIEW_WIDTH_PX}px`} eager />
          </div>,
          document.body,
        )}
    </li>
  );
}
