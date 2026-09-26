"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { Check, X } from "lucide-react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type { CommanderKeyId, RecContext } from "@mtg/core/contract";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/cards";
import { describeCostDelta } from "@/lib/format";
import { cutReasonShortLabel } from "@/lib/labels";
import { CardBack } from "./card-back";
import { PanelError } from "./panel-state";
import { ShuffleDeck } from "./shuffle-deck";
import { TagPills } from "./tag-pills";
import { useSwipeRater, type PickedSwap, type RaterTarget, type SwipeMode, type SwipeVote } from "./use-swipe-rater";

/** How far, as a share of the card's width, a drag has to travel to count as a swipe. */
const SWIPE_SHARE = 0.3;
/** A flick this fast (px/s) counts as a swipe even when it's short. */
const FLICK_VELOCITY = 600;
/** How long a swiped card takes to leave. */
const FLING_SECONDS = 0.22;
/** How far a leaving card travels, in card widths: far enough to be fully off-screen. */
const FLING_DISTANCE_WIDTHS = 1.8;
/**
 * After a swipe lands, the next one waits this long. A double tap on ✅ or ❌ would otherwise cast a second vote on the
 * card that just came up, which the player never saw.
 */
export const SWIPE_COOLDOWN_MS = 500;
/** Movement (px) past which a press on the card counts as a drag, so the click it ends in doesn't enlarge the card. */
const DRAG_CLICK_SLOP_PX = 5;
/** Card width (px) assumed before the card has been measured. */
const FALLBACK_CARD_WIDTH_PX = 240;
/** The card tilts up to TILT_MAX_DEG as it is dragged TILT_AT_PX to either side. */
const TILT_AT_PX = 260;
const TILT_MAX_DEG = 14;
/** A dragged card stays solid to FADE_START_PX and is gone by FADE_END_PX. */
const FADE_START_PX = 260;
const FADE_END_PX = 420;
/** The spring a card let go early settles back with. */
const SPRING_BACK = { type: "spring", stiffness: 520, damping: 32 } as const;
/** How much the ❌ and ✅ buttons swell as the card is dragged all the way to them. */
const BUTTON_PULL_SCALE = 0.18;
/** Cut reasons under the card being replaced, and the jobs flanking it. */
const MAX_REASONS = 2;
const MAX_TARGET_JOBS = 6;
/** The draw that opens a sitting: cards slide out of the deck, turn over, then their names and details fade in. */
export const DRAW = {
  startScale: 0.55,
  slideSeconds: 0.42,
  slideEase: [0.22, 0.9, 0.3, 1],
  flipDelaySeconds: 0.24,
  flipSeconds: 0.38,
  fadeSeconds: 0.25,
  targetFromY: 140,
  replacementFromY: -170,
  replacementDelaySeconds: 0.12,
  targetNameDelaySeconds: 0.55,
  replacementDetailsDelaySeconds: 0.7,
} as const;

export type Direction = 1 | -1;

export interface SwipeHandle {
  fling: (direction: Direction) => void;
}

/**
 * A card that follows the finger sideways with a slight tilt, springs back when let go early, and flies off when dragged
 * past the threshold or flicked. Vertical drags keep scrolling the page. Nothing is drawn over the card itself.
 */
export function SwipeCard({
  ref,
  onSwipe,
  canSwipe,
  onDrag,
  children,
}: {
  ref: Ref<SwipeHandle>;
  onSwipe: (direction: Direction) => void;
  /** False during the cooldown after the previous swipe: a drag past the threshold springs back instead. */
  canSwipe: () => boolean;
  /** -1..1: how far toward a swipe the card has been dragged. */
  onDrag: (progress: number) => void;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const leaving = useRef(false);
  // A drag ends in a click too, which would open the enlarged card the player was only trying to swipe.
  const dragged = useRef(false);
  const reduceMotion = useReducedMotion();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-TILT_AT_PX, 0, TILT_AT_PX], [-TILT_MAX_DEG, 0, TILT_MAX_DEG]);
  const opacity = useTransform(x, [-FADE_END_PX, -FADE_START_PX, 0, FADE_START_PX, FADE_END_PX], [0, 1, 1, 1, 0]);

  const width = () => box.current?.offsetWidth ?? FALLBACK_CARD_WIDTH_PX;

  function fling(direction: Direction) {
    if (leaving.current) return;
    leaving.current = true;
    onDrag(0);
    // A leaving card slides over the ❌ and ✅ buttons, so a quick second tap would land on it and start a drag. Motion
    // stops the fling for that drag, and a stopped animation never resolves: the swipe was never reported and every
    // later press returned early, freezing the view. Letting presses through to the button underneath avoids that.
    if (box.current) box.current.style.pointerEvents = "none";
    if (reduceMotion) {
      onSwipe(direction);
      return;
    }
    void animate(x, direction * width() * FLING_DISTANCE_WIDTHS, { duration: FLING_SECONDS, ease: "easeOut" }).then(() => onSwipe(direction));
  }

  useImperativeHandle(ref, () => ({ fling }));

  return (
    <motion.div
      ref={box}
      drag={reduceMotion ? false : "x"}
      dragMomentum={false}
      style={{ x, rotate, opacity, touchAction: "pan-y" }}
      onPointerDown={() => (dragged.current = false)}
      onClickCapture={(e) => {
        if (!dragged.current) return;
        dragged.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
      onDrag={(_, info) => {
        if (Math.abs(info.offset.x) > DRAG_CLICK_SLOP_PX || Math.abs(info.offset.y) > DRAG_CLICK_SLOP_PX) dragged.current = true;
        onDrag(Math.max(-1, Math.min(1, info.offset.x / (width() * SWIPE_SHARE))));
      }}
      onDragEnd={(_, info) => {
        const flicked = Math.abs(info.velocity.x) >= FLICK_VELOCITY && Math.sign(info.velocity.x) === Math.sign(info.offset.x);
        if ((Math.abs(info.offset.x) >= width() * SWIPE_SHARE || flicked) && canSwipe()) {
          fling(info.offset.x > 0 ? 1 : -1);
        } else {
          onDrag(0);
          void animate(x, 0, SPRING_BACK);
        }
      }}
      // Above the ❌ and ✅ buttons, so a dragged card slides over them instead of under them: nothing covers the card.
      className="relative z-10 cursor-grab select-none active:cursor-grabbing [&_img]:pointer-events-none"
    >
      {children}
    </motion.div>
  );
}

/**
 * The first pair of a sitting is drawn from the deck: each card slides out from the middle of the screen face down and
 * flips over. Later cards just appear. `play` only counts when the card first mounts.
 */
export function DrawnCard({
  play,
  delay,
  fromY,
  className,
  children,
}: {
  play: boolean;
  delay: number;
  /** Where the card starts, in px from its resting place: toward the deck in the middle of the screen. */
  fromY: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={cn("relative [perspective:1400px]", className)}
      initial={play ? { y: fromY, scale: DRAW.startScale, opacity: 0 } : false}
      animate={{ y: 0, scale: 1, opacity: 1 }}
      transition={{ delay, duration: DRAW.slideSeconds, ease: DRAW.slideEase }}
    >
      <motion.div
        className="relative [transform-style:preserve-3d]"
        initial={play ? { rotateY: 180 } : false}
        animate={{ rotateY: 0 }}
        transition={{ delay: delay + DRAW.flipDelaySeconds, duration: DRAW.flipSeconds, ease: "easeInOut" }}
      >
        <div className="[backface-visibility:hidden]">{children}</div>
        <div aria-hidden className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
          <CardBack sizes="256px" className="h-full" />
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The ✅ button's colour: gold for a swap, or the job's own colour when the swipe is a cut or an add. */
const ACCEPT_TONE = {
  primary: "bg-primary text-primary-foreground shadow-[0_2px_0_color-mix(in_oklch,var(--primary),black_35%)] hover:bg-primary/90",
  cut: "bg-cut text-background shadow-[0_2px_0_color-mix(in_oklch,var(--cut),black_35%)] hover:bg-cut/90",
  add: "bg-add text-background shadow-[0_2px_0_color-mix(in_oklch,var(--add),black_35%)] hover:bg-add/90",
} as const;

const PULL_RING = { primary: "ring-primary/25", cut: "ring-cut/30", add: "ring-add/30" } as const;

export type AcceptTone = keyof typeof ACCEPT_TONE;

/** The ❌ and ✅ buttons beside the replacement: they swell as the card is dragged toward them. */
export function SideButton({
  kind,
  label,
  pull,
  disabled,
  onClick,
  tone = "primary",
}: {
  kind: "pass" | "swap";
  tone?: AcceptTone;
  label: string;
  /** 0..1 */
  pull: number;
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = kind === "swap" ? Check : X;
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ transform: `scale(${1 + pull * BUTTON_PULL_SCALE})` }}
      className={cn(
        "flex size-14 items-center justify-center rounded-full transition-[transform,box-shadow,background-color] duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40",
        kind === "swap" ? ACCEPT_TONE[tone] : "border border-input bg-sleeve text-foreground shadow-[0_2px_0_var(--seam)] hover:bg-muted",
        pull >= 1 && ["ring-4", PULL_RING[tone]],
      )}
    >
      <Icon aria-hidden className="size-7" strokeWidth={2.75} />
    </button>
  );
}

export function SwipeRater({
  targets,
  context,
  commanderKeyId,
  mode = "deck",
  picked,
  onPick,
  onVote,
  onFinish,
  viewRef,
}: {
  targets: readonly RaterTarget[];
  context: RecContext;
  commanderKeyId: CommanderKeyId | null;
  mode?: SwipeMode;
  /** Deck tool: swaps already picked in this sitting, and where new picks go. */
  picked?: readonly PickedSwap[];
  onPick?: (swap: PickedSwap) => void;
  onVote?: (vote: SwipeVote) => void;
  onFinish: () => void;
  /** Receives the view's element once it shows cards (not while the deck is still shuffling), e.g. to scroll it into place. */
  viewRef?: (element: HTMLElement | null) => void;
}) {
  const rater = useSwipeRater({ targets, context, commanderKeyId, mode, picked, onPick, onVote, onFinish });
  const reduceMotion = useReducedMotion();
  const card = useRef<SwipeHandle>(null);
  const [drag, setDrag] = useState(0);
  /** When the last swipe landed, for SWIPE_COOLDOWN_MS. */
  const lastSwipeAt = useRef(0);
  const { target, loaded, candidate } = rater;
  const inRater = mode === "rater";

  const canSwipe = () => Date.now() - lastSwipeAt.current >= SWIPE_COOLDOWN_MS;

  const swiped = (direction: Direction) => {
    lastSwipeAt.current = Date.now();
    if (direction === 1) rater.swapIn();
    else rater.pass();
  };

  const act = (direction: Direction) => {
    if (!candidate || !canSwipe()) return;
    if (card.current) card.current.fling(direction);
    else swiped(direction);
  };

  // Arrow keys do what the buttons do, unless the player is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      act(e.key === "ArrowRight" ? 1 : -1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!target) return null;
  // Until the first card's replacements arrive, the deck keeps shuffling; then the first pair is drawn from it.
  if (rater.targetIndex === 0 && !loaded) {
    return <ShuffleDeck label="Finding replacements" />;
  }
  const drawing = !reduceMotion && rater.targetIndex === 0 && rater.candidateIndex === 0;
  const targetName = displayName(target.card);
  const reasons = (target.reasons ?? []).map((r) => cutReasonShortLabel[r]).slice(0, MAX_REASONS);
  const jobs = candidate
    ? [...new Set(candidate.matchedTags.map((m) => (m.distance === 0 || !m.via ? m.candidateTag.label : m.via.label)))]
    : [];
  // The same jobs, named as the card being replaced has them: they flank its image, half on each side.
  const targetJobs = candidate
    ? [...new Set(candidate.matchedTags.map((m) => (m.distance === 0 || !m.via ? m.targetTag.label : m.via.label)))].slice(0, MAX_TARGET_JOBS)
    : [];

  return (
    <section
      ref={viewRef}
      aria-label={inRater ? "Rate replacements" : "Swipe through cards to replace"}
      className="mx-auto flex w-full max-w-md scroll-mt-44 flex-col"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          Card {rater.targetIndex + 1} of {rater.targetCount}
          {inRater ? "" : " to replace"}
        </p>
        <Button type="button" size="sm" variant="ghost" onClick={onFinish}>
          {inRater ? "Done" : "Finish"}
        </Button>
      </div>

      <figure className="mt-1 flex flex-col items-center text-center">
        {/* Both cards scale with the screen's height so the whole sitting fits on a phone below the deck bar.
            --swipe-chrome is everything on screen that isn't a card, and each host sets its own. */}
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5">
          <TagPills labels={targetJobs.filter((_, i) => i % 2 === 0)} label={`What ${targetName} does`} align="end" />
          <DrawnCard play={drawing} delay={0} fromY={DRAW.targetFromY} className="w-[clamp(4.5rem,calc((100dvh_-_var(--swipe-chrome,35rem))*0.32),11rem)]">
            <ZoomableCard card={target.card}>
              <CardImage card={target.card} alt={`${inRater ? "Card being replaced" : "In your deck"}: ${target.card.name}`} sizes="176px" eager className={inRater ? undefined : "opacity-80 saturate-50"} />
            </ZoomableCard>
          </DrawnCard>
          <TagPills labels={targetJobs.filter((_, i) => i % 2 === 1)} label={`More of what ${targetName} does`} align="start" />
        </div>
        {/* While the first pair is being drawn, the names wait until the cards have turned over. */}
        <motion.figcaption className="mt-1.5" initial={drawing ? { opacity: 0 } : false} animate={{ opacity: 1 }} transition={{ delay: DRAW.targetNameDelaySeconds, duration: DRAW.fadeSeconds }}>
          <span className="block font-heading text-lg leading-tight font-extrabold">{targetName}</span>
          {reasons.length > 0 && <span className="block text-xs text-muted-foreground">{reasons.join(", ")}</span>}
        </motion.figcaption>
      </figure>

      <div aria-hidden className="my-3 h-px bg-seam" />

      {!loaded ? (
        <div role="status" aria-label="Finding replacements" className="grid grid-cols-[3.5rem_1fr_3.5rem] items-center gap-2">
          <span />
          <Skeleton className="mx-auto aspect-[488/680] w-[clamp(7rem,calc((100dvh_-_var(--swipe-chrome,35rem))*0.72),16rem)] max-w-full rounded-[4.75%/3.4%] bg-seam" />
          <span />
        </div>
      ) : loaded.status === "error" ? (
        <div className="flex flex-col items-center gap-3">
          <PanelError message={loaded.message} />
          <Button type="button" variant="outline" onClick={rater.keep}>
            {inRater ? "Skip" : "Keep"} {targetName}
          </Button>
        </div>
      ) : !candidate ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="max-w-xs text-sm">
            {rater.candidateCount === 0 ? `No replacements do the same job as ${targetName}.` : `That's every replacement for ${targetName}.`}
          </p>
          <Button type="button" onClick={rater.keep}>
            {inRater ? "Skip" : "Keep"} {targetName}
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_3.5rem] items-center gap-2">
            <SideButton kind="pass" label={inRater ? `Not a fit: ${candidate.card.name}` : `Pass on ${candidate.card.name}`} pull={Math.max(0, -drag)} disabled={false} onClick={() => act(-1)} />
            {/* Keyed by the pair: the rater's next card can open on the same replacement, and reusing the card that
                just flew off would leave it off-screen and still marked as leaving. */}
            <SwipeCard key={`${target.card.id}:${candidate.card.id}`} ref={card} onDrag={setDrag} canSwipe={canSwipe} onSwipe={swiped}>
              <DrawnCard play={drawing} delay={DRAW.replacementDelaySeconds} fromY={DRAW.replacementFromY} className="mx-auto w-[clamp(7rem,calc((100dvh_-_var(--swipe-chrome,35rem))*0.72),16rem)] max-w-full">
                <ZoomableCard card={candidate.card}>
                  <CardImage card={candidate.card} variant="large" alt={`Replacement: ${candidate.card.name}`} sizes="256px" eager className="shadow-[0_0_0_2px_var(--color-primary)]" />
                </ZoomableCard>
              </DrawnCard>
            </SwipeCard>
            <SideButton kind="swap" label={inRater ? `Good fit: ${candidate.card.name}` : `Swap in ${candidate.card.name}`} pull={Math.max(0, drag)} disabled={false} onClick={() => act(1)} />
          </div>
          <motion.div
            aria-live="polite"
            className="mt-3 text-center"
            initial={drawing ? { opacity: 0 } : false}
            animate={{ opacity: 1 }}
            transition={{ delay: DRAW.replacementDetailsDelaySeconds, duration: DRAW.fadeSeconds }}
          >
            <p className="font-heading text-xl leading-tight font-extrabold">{displayName(candidate.card)}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {describeCostDelta(candidate.costDelta)} · {rater.candidateIndex + 1} of {rater.candidateCount}
            </p>
            {candidate.functionalTwin ? (
              <p className="mt-1 text-sm font-bold text-primary">Same rules as {targetName}, under a different name.</p>
            ) : (
              <TagPills labels={jobs} label={`What ${displayName(candidate.card)} does too`} className="mt-1.5" />
            )}
          </motion.div>
          <div className="mt-2 flex justify-center">
            <Button type="button" size="sm" variant="link" onClick={rater.keep}>
              {inRater ? "Skip" : "Keep"} {targetName}
            </Button>
          </div>
        </>
      )}
      {rater.voteError && (
        <p className="mt-2 text-center text-xs text-muted-foreground">{`Your last vote wasn't saved: ${rater.voteError}`}</p>
      )}
    </section>
  );
}

/** What the player picked in a sitting. The swaps are already written into the decklist when this shows. */
export function SwipeSummary({
  swaps,
  updating,
  onSwipeAgain,
  onShowList,
  viewRef,
}: {
  swaps: readonly PickedSwap[];
  updating: boolean;
  onSwipeAgain: () => void;
  onShowList: () => void;
  viewRef?: (element: HTMLElement | null) => void;
}) {
  const heading = swaps.length === 0 ? "No swaps picked" : `${swaps.length} swap${swaps.length === 1 ? "" : "s"} picked`;
  return (
    <section ref={viewRef} aria-labelledby="swipe-summary-heading" className="mx-auto flex w-full max-w-md scroll-mt-44 flex-col gap-4">
      <div>
        <h2 id="swipe-summary-heading" className="font-heading text-3xl leading-none font-extrabold tracking-tight">
          {heading}
        </h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {swaps.length === 0 ? "Your deck is unchanged." : updating ? "Updating your decklist…" : "Your decklist now has these swaps."}
        </p>
      </div>
      {swaps.length > 0 && (
        <ul aria-label="Swaps picked" className="flex flex-col divide-y divide-seam rounded-lg border border-seam bg-sleeve">
          {swaps.map((s) => (
            <li key={s.target.id} className="grid grid-cols-[4.5rem_1fr_4.5rem] items-center gap-3 p-3">
              <CardImage card={s.target} variant="small" alt="" sizes="72px" className="opacity-80 saturate-50" />
              <p className="text-sm leading-snug">
                <span className="block text-muted-foreground">Cut {displayName(s.target)}</span>
                <span className="block font-bold">Add {displayName(s.replacement)}</span>
              </p>
              <CardImage card={s.replacement} variant="small" alt="" sizes="72px" />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="lg" onClick={onSwipeAgain} disabled={updating}>
          Swipe again
        </Button>
        <Button type="button" size="lg" variant="outline" onClick={onShowList} disabled={updating}>
          See the list
        </Button>
      </div>
    </section>
  );
}
