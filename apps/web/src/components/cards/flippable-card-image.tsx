"use client";

import { useState, type ComponentProps } from "react";
import { RotateCcw } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "./card-image";

/** Card image with a front/back toggle for double-faced cards; plain image otherwise. */
export function FlippableCardImage({
  card,
  ...imageProps
}: { card: CardSummary } & Omit<ComponentProps<typeof CardImage>, "card" | "face">) {
  const [face, setFace] = useState<"front" | "back">("front");
  const hasBack = Boolean(card.images?.back);

  return (
    <>
      <CardImage card={card} face={face} {...imageProps} />
      {hasBack && (
        <button
          type="button"
          onClick={() => setFace((f) => (f === "front" ? "back" : "front"))}
          aria-pressed={face === "back"}
          className="mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-bold text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-primary"
        >
          <RotateCcw aria-hidden className="size-3.5" />
          {face === "front" ? "Show back" : "Show front"}
        </button>
      )}
    </>
  );
}
