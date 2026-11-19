"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { CardBack } from "@/components/deck/card-back";
import { sampleCard } from "@/lib/sample-cards";

/**
 * The cards that fall onto the hero's table, in the order they fall and load. Twenty: enough that the loop doesn't
 * read as a loop, few enough that their art (about 93 KB each on `normal`) stays a small, late download.
 */
const POOL: CardSummary[] = [
  "Chulane, Teller of Tales",
  "Rhystic Study",
  "Cultivate",
  "Counterspell",
  "Birds of Paradise",
  "Sol Ring",
  "Swords to Plowshares",
  "Three Visits",
  "Cyclonic Rift",
  "Beast Whisperer",
  "Command Tower",
  "Lightning Bolt",
  "Fact or Fiction",
  "Kodama's Reach",
  "Guardian Project",
  "Path to Exile",
  "Llanowar Elves",
  "Arcane Signet",
  "Swan Song",
  "Growth Spiral",
].map(sampleCard);

/** Most cards on the table at once: the next one to land fades the oldest out. */
const MAX_ON_TABLE = 15;
/** The first few fall quickly so the table fills soon after the page opens, then the pace eases off. */
const QUICK_FALLS = 8;
const QUICK_FALL_GAP_MS = 450;
const FALL_GAP_MS = 800;
/** Long enough to read as a drop through the air, short enough that the next card isn't waiting on it. */
const FALL_S = 0.9;
/** A card fades in over the first part of its fall, so it seems to come out of the dark above the table. */
const FALL_FADE_S = 0.4;
/** The oldest card fades out slowly, so the pile thins without anything seeming to vanish. */
const FADE_OUT_S = 1.2;
/** A face-down card turns over this fast once its art arrives. */
const FLIP_S = 0.5;
/** Depth for the turn-over, in px: low enough that the card visibly tips toward the viewer. */
const FLIP_PERSPECTIVE_PX = 800;

/**
 * Seen from above, a falling card starts large (close to the eye) and shrinks to its size on the table, dipping just
 * under it as it slaps down. `LAND_AT` is where in the fall it touches the table.
 */
const FALL_START_SCALE = 1.55;
const LAND_SCALE = 0.97;
const LAND_AT = 0.82;
/** It drifts in from slightly above where it lands, in % of its own height. */
const FALL_DRIFT_Y_PCT = -18;
/** How far it spins while it falls, at most, in degrees either way. */
const FALL_SPIN_DEG = 40;
/** The table's matching curve (`--ease-table` in globals.css). */
const EASE_TABLE = [0.2, 0.7, 0.2, 1] as const;

/**
 * Below `md` (phones and small tablets, one column) the table is the whole hero, headline included: a card's middle
 * lands anywhere in it, and up to this far past each edge (as a fraction of the hero's width or height), so some cards
 * hang out of frame and the hero clips them.
 */
const PHONE_OVERHANG = 0.1;
/** On a phone a card is placed by its middle: offset by half its own size, in %. */
const PHONE_CENTRE_PCT = -50;
/**
 * Beside the headline (`md` up, where the hero turns two columns) the table is everything right of the text, and cards
 * land anywhere across it.
 */
const BESIDE_QUERY = "(min-width: 768px)";
/**
 * Vertically the pile sits a little low, like the old fan: the hero's top edge is close above the table, and a tilted
 * card's corners reach past it first.
 */
const SPREAD_Y_PCT = 7;
const PILE_DROP_Y_PCT = 3;
/** Resting angle, at most, in degrees either way. */
const REST_TILT_DEG = 24;

/**
 * The shadow under a falling card starts far and faint (the card is high above the table) and closes in under it as it
 * lands. Offsets in px.
 */
const SHADOW_HIGH = { x: 22, y: 34, scale: 1.08, opacity: 0 } as const;
const SHADOW_LANDED = { x: 3, y: 7, scale: 1, opacity: 0.55 } as const;

/** Art loads only once the page has finished loading and the browser is idle, at most this long after. */
const IDLE_TIMEOUT_MS = 2000;
/** Without `requestIdleCallback` (Safari), this long after load instead. */
const IDLE_FALLBACK_MS = 300;

const CARD_SIZES = "(min-width: 768px) 172px, 42vw";
const CARD_CORNERS = "rounded-[4.75%/3.4%]";

/** One card on the table: where it lands, how it falls and which card it is. */
type Fall = {
  key: number;
  cardIndex: number;
  card: CardSummary;
  /** CSS `left` and `top` of the card on the table. */
  left: string;
  top: string;
  /** A further offset in % of the card's own size. */
  x: number;
  y: number;
  rotate: number;
  spin: number;
};

/** A value in [-1, 1] weighted toward 0, so the pile is thickest in the middle of the table. */
function centred(): number {
  return Math.random() + Math.random() - 1;
}

/** A value in [-PHONE_OVERHANG, 1 + PHONE_OVERHANG], even across the range. */
function anywhere(): number {
  return -PHONE_OVERHANG + Math.random() * (1 + 2 * PHONE_OVERHANG);
}

/** Where a card rests: anywhere in the hero on a phone, anywhere across the table beside the headline. */
function restingPlace(): Pick<Fall, "left" | "top" | "x" | "y"> {
  if (window.matchMedia(BESIDE_QUERY).matches) {
    return {
      // The card's left edge sits along the table's free width (its width less one card's), so it stays on the table.
      left: `calc((100% - var(--card-w)) * ${Math.random()})`,
      top: "0%",
      x: 0,
      y: PILE_DROP_Y_PCT + centred() * SPREAD_Y_PCT,
    };
  }
  return {
    left: `${anywhere() * 100}%`,
    top: `${anywhere() * 100}%`,
    x: PHONE_CENTRE_PCT,
    y: PHONE_CENTRE_PCT,
  };
}

function newFall(key: number): Fall {
  const cardIndex = key % POOL.length;
  return {
    key,
    cardIndex,
    card: POOL[cardIndex]!,
    ...restingPlace(),
    rotate: centred() * REST_TILT_DEG,
    spin: (Math.random() * 2 - 1) * FALL_SPIN_DEG,
  };
}

/**
 * Loads the pool's art one card at a time, once the page has loaded and the browser is idle, so it never competes
 * with what the page needs. Each decoded image is kept for the page's life, so a card coming round again is drawn
 * from memory instead of fetched. Returns which cards are ready.
 */
function usePoolArt(): boolean[] {
  const [ready, setReady] = useState<boolean[]>(() => POOL.map(() => false));
  const kept = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | undefined;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    async function loadAll() {
      for (const [i, card] of POOL.entries()) {
        const src = card.images?.front.normal;
        if (!src) continue;
        const img = new Image();
        img.decoding = "async";
        img.fetchPriority = "low";
        img.src = src;
        try {
          await img.decode();
        } catch {
          // Stays face down: a card back on the table is still a card on the table.
          continue;
        }
        if (cancelled) return;
        kept.current[i] = img;
        setReady((prev) => prev.map((value, j) => value || j === i));
      }
    }

    function whenIdle() {
      if ("requestIdleCallback" in window) {
        idleHandle = window.requestIdleCallback(() => void loadAll(), { timeout: IDLE_TIMEOUT_MS });
      } else {
        timeoutHandle = setTimeout(() => void loadAll(), IDLE_FALLBACK_MS);
      }
    }

    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", whenIdle);
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle);
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    };
  }, []);

  return ready;
}

/** True while the tab is in front. */
function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** A card that lands face down while its art loads and turns over once it has. */
function TableCard({ card, faceUp, still }: { card: CardSummary; faceUp: boolean; still: boolean }) {
  return (
    <motion.div
      className="relative aspect-[488/680] w-full"
      style={{ transformStyle: "preserve-3d", transformPerspective: FLIP_PERSPECTIVE_PX }}
      initial={false}
      animate={{ rotateY: faceUp ? 0 : 180 }}
      transition={{ duration: still ? 0 : FLIP_S, ease: EASE_TABLE }}
    >
      <div className="absolute inset-0 backface-hidden">{faceUp && <CardImage card={card} alt="" sizes={CARD_SIZES} eager />}</div>
      <div className="absolute inset-0 backface-hidden [transform:rotateY(180deg)]">
        <CardBack sizes={CARD_SIZES} eager className="shadow-none" />
      </div>
    </motion.div>
  );
}

/**
 * The hero's table: cards fall onto it one at a time into a messy pile, never more than `MAX_ON_TABLE` at once, the
 * oldest fading as the next lands. They fall face down until their art has loaded, then turn over. It runs only while
 * the hero is on screen and the tab is in front; with reduced motion it's a still pile. Decorative: the headline says
 * what the page is.
 */
export function HeroPile() {
  const table = useRef<HTMLDivElement>(null);
  const onScreen = useInView(table);
  const visible = usePageVisible();
  const reduceMotion = useReducedMotion() ?? false;
  const ready = usePoolArt();
  const [falls, setFalls] = useState<Fall[]>([]);
  const nextKey = useRef(0);

  // Drop the next card, then wait before the one after. Pauses off screen and in a background tab. With reduced motion,
  // one still pile laid out at once, with no loop.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (reduceMotion) {
      if (nextKey.current > 0) return;
      timer = setTimeout(() => {
        setFalls(Array.from({ length: MAX_ON_TABLE }, (_, i) => newFall(i)));
        nextKey.current = MAX_ON_TABLE;
      }, 0);
      return () => clearTimeout(timer);
    }
    if (!onScreen || !visible) return;
    const drop = () => {
      const key = nextKey.current++;
      setFalls((prev) => [...prev.slice(-(MAX_ON_TABLE - 1)), newFall(key)]);
      timer = setTimeout(drop, nextKey.current < QUICK_FALLS ? QUICK_FALL_GAP_MS : FALL_GAP_MS);
    };
    timer = setTimeout(drop, nextKey.current === 0 ? 0 : FALL_GAP_MS);
    return () => clearTimeout(timer);
  }, [reduceMotion, onScreen, visible]);

  return (
    // On a phone this box only keeps the hero's room for the pile; the table itself covers the whole hero (the nearest
    // positioned ancestor), under the headline (z-20). From `md` the table spans its column.
    <div aria-hidden className="h-[10rem] w-full sm:h-[16rem] md:h-auto">
      {/* --card-w is one card's width at each size. */}
      <div
        ref={table}
        className="pointer-events-none absolute inset-0 isolate [--card-w:9.5rem] sm:[--card-w:9rem] md:relative md:inset-auto md:h-[12.5rem] md:w-full lg:h-[15rem] lg:[--card-w:10.75rem]"
      >
        <AnimatePresence>
          {falls.map((fall) => {
            const rest = { x: `${fall.x}%`, y: `${fall.y}%`, rotate: fall.rotate };
            return (
              <motion.div
                key={fall.key}
                className="absolute w-(--card-w)"
                style={{ zIndex: fall.key, left: fall.left, top: fall.top }}
                initial={
                  reduceMotion
                    ? false
                    : {
                        ...rest,
                        y: `${fall.y + FALL_DRIFT_Y_PCT}%`,
                        rotate: fall.rotate + fall.spin,
                        scale: FALL_START_SCALE,
                        opacity: 0,
                      }
                }
                animate={{ ...rest, scale: reduceMotion ? 1 : [FALL_START_SCALE, LAND_SCALE, 1], opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : FADE_OUT_S, ease: "easeOut" } }}
                transition={{
                  duration: FALL_S,
                  ease: EASE_TABLE,
                  scale: { duration: FALL_S, times: [0, LAND_AT, 1], ease: ["easeIn", "easeOut"] },
                  opacity: { duration: FALL_FADE_S, ease: "easeOut" },
                }}
              >
                {/* The shadow is its own layer, so only its transform and opacity animate, never a box-shadow. */}
                <motion.div
                  className={`absolute inset-0 bg-black blur-md ${CARD_CORNERS}`}
                  initial={reduceMotion ? false : SHADOW_HIGH}
                  animate={SHADOW_LANDED}
                  transition={{ duration: FALL_S, ease: EASE_TABLE }}
                />
                <TableCard card={fall.card} faceUp={ready[fall.cardIndex] ?? false} still={reduceMotion} />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
