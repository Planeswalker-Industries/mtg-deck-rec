"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { CardBack } from "@/components/deck/card-back";
import { CardImage } from "./card-image";

/** How long a card takes to turn over once its face has loaded: quick enough not to hold up the next swipe. */
const DEAL_TURN_S = 0.4;
/** The turn's depth, as the homepage's falling cards use (`hero-pile.tsx`). */
const DEAL_PERSPECTIVE_PX = 800;
/** A card dealt face down, turned half a revolution. */
const FACE_DOWN_DEG = 180;

type CardImageProps = Omit<ComponentProps<typeof CardImage>, "ref" | "onLoad" | "onError">;

/** The image URL a `CardImage` with these props loads, or null where it shows its dashed placeholder. */
function imageSrc({ card, face = "front", variant = "normal" }: Pick<CardImageProps, "card" | "face" | "variant">): string | null {
  const set = face === "back" ? card.images?.back : card.images?.front;
  return set?.[variant] ?? null;
}

/**
 * Fetches the images of the cards a swipe would deal next, so they are in the browser's cache when dealt and show
 * their face at once. Call it from an effect or a timer, never while rendering.
 */
export function preloadCardImages(cards: readonly (CardSummary | null | undefined)[]) {
  for (const card of cards) {
    const src = card ? imageSrc({ card }) : null;
    if (src) new window.Image().src = src;
  }
}

/** `preloadCardImages` for a component: fetches again only when the list of images changes, not on every render. */
export function usePreloadCardImages(cards: readonly (CardSummary | null | undefined)[]) {
  // Keyed by the URLs, never by the array: callers build it afresh each render.
  const srcs = cards.flatMap((card) => (card ? [imageSrc({ card })] : [])).join(" ");
  useEffect(() => {
    for (const src of srcs.split(" ")) if (src) new window.Image().src = src;
  }, [srcs]);
}

/**
 * A journey card (Add, Cut, Fix, Swap) dealt face down: the card back shows in place of the image while it loads,
 * then turns over to the face. An image already in the cache shows its face at once, and with reduced motion the
 * face replaces the back with no turn. A card with no image shows `CardImage`'s placeholder, never the back.
 *
 * The back stands in place of the face, never over it, so the artist and copyright line shows once it has turned.
 */
export function DealtCard(props: CardImageProps) {
  const src = imageSrc(props);
  if (!src) return <CardImage {...props} />;
  // A new card is dealt afresh: keyed by its image, so a browse to the next card lays it face down again.
  return <FaceDown key={src} {...props} />;
}

function FaceDown({ className, sizes, ...props }: CardImageProps) {
  const image = useRef<HTMLImageElement>(null);
  /** down: the back shows; turning: the face has loaded and turns over; up: the face showed at once. */
  const [state, setState] = useState<"down" | "turning" | "up">("down");
  const reduceMotion = useReducedMotion() ?? false;

  // A cached image is complete before the first paint: show its face with no turn.
  useLayoutEffect(() => {
    const img = image.current;
    if (img?.complete && img.naturalWidth > 0) setState("up");
  }, []);

  // A face that fails to load turns over too, so its alt text shows rather than a back that never turns.
  const turn = () => setState((s) => (s === "down" ? "turning" : s));

  return (
    <motion.div
      data-dealt={state === "down" ? "down" : "up"}
      className="grid"
      style={{ transformStyle: "preserve-3d", transformPerspective: DEAL_PERSPECTIVE_PX }}
      initial={false}
      animate={{ rotateY: state === "down" ? FACE_DOWN_DEG : 0 }}
      transition={{ duration: state === "turning" && !reduceMotion ? DEAL_TURN_S : 0 }}
    >
      <CardImage
        {...props}
        ref={image}
        sizes={sizes}
        onLoad={turn}
        onError={turn}
        className={cn("backface-hidden [grid-area:1/1]", className)}
      />
      <CardBack sizes={sizes} eager className="shadow-none backface-hidden [grid-area:1/1] [transform:rotateY(180deg)]" />
    </motion.div>
  );
}
