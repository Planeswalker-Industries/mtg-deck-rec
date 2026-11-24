"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { Popover } from "radix-ui";
import { AnimatePresence, motion, useAnimationControls, useInView, useReducedMotion } from "motion/react";
import { Check, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react";
import { ringRange, ringWorsens, statRing, towardTarget, type RingZone, type StatLine } from "@mtg/core/journey";
import { cn } from "cn";
import { MANA_SYMBOL_URL } from "@/components/deck/color-identity";
import { EASE_SINE, RING_CHECK_GROW, TIP_HOVER_DELAY_MS } from "@/lib/constants";
import { Mark } from "./level";
import { ringTip } from "./stat-chip-copy";

/**
 * Deck stats as rings (owner, 2026-11-23), drawn the way an activity ring reads: the first lap closes at the bottom of a
 * line's range and its count gives way to a check, then OK; a darker green second lap fills across the range; past the
 * top the ring turns red, shakes and shows a warning. Short lines are amber, far short ones red. Every colour comes with
 * a word or an icon: the count, a check, OK or the warning. What to do about a line is in its tip, opened by a hover or
 * a tap, so the rings sit close and read at a glance (owner, 2026-11-23).
 *
 * A group fills the way the owner's Godot tween does (2026-11-23): one ring at a time, each on a sine curve, popping
 * from a little larger back to its size as it fills, the next starting as it ends.
 */

/** Ring diameters in px: the main lines, the card types, the colour sources. */
const RING_PX = { lg: 72, sm: 56, mana: 48 } as const;
/** Ring stroke widths in px, at the same sizes. */
const STROKE_PX = { lg: 7, sm: 6, mana: 5 } as const;
/** How long a ring takes to fill when its turn comes, or to move to a new count; the next ring starts as it ends. */
const FILL_S = 0.4;
/** A ring pops to this scale as its turn comes, and settles back to its size as it fills. */
const POP_FROM_SCALE = 1.1;
/** A card on screen moves the rings after this pause, so the eye can catch which ones move. */
const PREVIEW_DELAY_MS = 300;
const MS_PER_S = 1000;
/** A ring that closes shows its check this long before it settles on OK. */
const CHECK_HOLD_MS = 700;
/** The shake when a ring steps toward a bad end: offsets in px, over this long. */
const SHAKE_X_PX = [0, -4, 4, -3, 3, -1, 0];
const SHAKE_S = 0.45;
/** What the centre shrinks to as one content gives way to the next (count, check, OK). */
const CENTRE_SWAP_SCALE = 0.85;
const CENTRE_SWAP_S = 0.35;
/** A ring that opens over its range shakes once it is this far through filling. */
const OVER_SHAKE_AT = 0.5;
/** The mana symbol under a colour ring, in px. */
const SYMBOL_PX = 16;
/** A tip opened by hovering stays this long after the pointer leaves its ring, so the pointer can reach its Fix. */
const TIP_LEAVE_MS = 150;

export type RingSize = keyof typeof RING_PX;

const LAP_STROKE: Record<RingZone, string> = {
  severe: "stroke-destructive",
  low: "stroke-warning",
  ok: "stroke-success",
  over: "stroke-success",
};
const COUNT_TEXT: Record<RingZone, string> = {
  severe: "text-destructive",
  low: "text-warning",
  ok: "text-success",
  over: "text-destructive",
};
/** The second lap: a darker green inside the range, red once over it. */
const EXTRA_STROKE: Record<RingZone, string> = {
  severe: "stroke-transparent",
  low: "stroke-transparent",
  ok: "stroke-[color-mix(in_oklch,var(--success)_62%,var(--ink))]",
  over: "stroke-destructive",
};

/**
 * "4 short", "3 over": whole cards against the target as shown. An off line is never "0 short": a colour line shows its
 * sources rounded down but is judged on the exact count, so it can be just under a target it seems to meet.
 */
const offWords = (value: number, target: number, over: boolean) => {
  const delta = value - Math.round(target);
  return over ? `${Math.max(1, delta)} over` : `${Math.max(1, -delta)} short`;
};

/** The sentence a screen reader hears for a ring. */
function spokenRing(line: StatLine, zone: RingZone, minimum: boolean, preview: { value: number; better: boolean } | null): string {
  const target = Math.round(line.target);
  const where =
    line.state === "ignored"
      ? "ignored"
      : zone === "ok"
        ? "in line"
        : `${offWords(line.value, line.target, zone === "over")} ${minimum ? `of ${target} needed` : `against a target of ${target}`}`;
  const withCard = preview ? `; ${preview.value} with this card, ${preview.better ? "toward" : "away from"} the target` : "";
  return `${line.label}: ${line.value}, ${where}${withCard}`;
}

type Shown = Pick<StatLine, "value" | "target" | "ok">;
const sameShown = (a: Shown, b: Shown) => a.value === b.value && a.target === b.target && a.ok === b.ok;

/** Holds a ring's count back for `delayMs` after it changes, so a preview lands a beat after the card does. */
function useDelayedShown(next: Shown, delayMs: number): Shown {
  const [shown, setShown] = useState<Shown>(next);
  const { value, target, ok } = next;
  useEffect(() => {
    if (sameShown(shown, { value, target, ok })) return;
    const timer = setTimeout(() => setShown({ value, target, ok }), delayMs);
    return () => clearTimeout(timer);
  }, [value, target, ok, shown, delayMs]);
  return shown;
}

/**
 * One line as a ring, with its label (or mana symbol) under it and, when it's off, how far off and what to do about it.
 * `after` is the line as it would stand with the card on screen answered: the ring moves to it after a short pause,
 * shakes when that is a step toward a bad end, and a chevron says which way the count would go. A ring in range can be
 * tapped to show its count in place of OK.
 */
export function StatRing({
  line,
  after,
  size,
  index = 0,
  action,
  tipExtra,
}: {
  line: StatLine;
  after?: StatLine | undefined;
  size: RingSize;
  /** Its place in its group: the rings fill in turn. */
  index?: number;
  /** Beside the label: Fix, Count it. */
  action?: ReactNode;
  /** A second paragraph in the tip: the Lands ring's land-drop odds. */
  tipExtra?: string | undefined;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const box = useRef<HTMLLIElement>(null);
  const inView = useInView(box, { once: true });
  const minimum = line.group === "colours";
  const ignored = line.state === "ignored";
  // Its turn in the group's first fill; once filled, a ring moves at once.
  const turnS = index * FILL_S;
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (!inView || opened) return;
    const timer = setTimeout(() => setOpened(true), (turnS + FILL_S) * MS_PER_S);
    return () => clearTimeout(timer);
  }, [inView, opened, turnS]);
  const delayS = reduceMotion || opened ? 0 : turnS;

  // The pop as its turn comes: from a little larger back to its size, while it fills.
  const pop = useAnimationControls();
  useEffect(() => {
    if (!inView || reduceMotion) return;
    void pop.start({ scale: [POP_FROM_SCALE, 1], transition: { duration: FILL_S, delay: turnS, ease: EASE_SINE } });
  }, [inView, reduceMotion, pop, turnS]);

  const previewing = after !== undefined && !sameShown(after, line);
  const shown = useDelayedShown(previewing ? after : line, reduceMotion ? 0 : PREVIEW_DELAY_MS);
  const ring = statRing(shown.value, shown.target, shown.ok, minimum);
  const zone = ignored ? "low" : ring.zone;
  /** The line's own zone, without the card on screen. */
  const ownZone = statRing(line.value, line.target, line.ok, minimum).zone;

  // A shake for each step toward a bad end: a preview that would make things worse than the line is, or the line itself
  // getting worse (a card answered). A preview ending, the ring going back to the line's own zone, never shakes. A ring
  // that opens over its range shakes once it has filled.
  const shake = useAnimationControls();
  const lastShown = useRef<RingZone | null>(null);
  const lastOwn = useRef<RingZone | null>(null);
  useEffect(() => {
    if (!inView) return;
    const opening = lastShown.current === null;
    const fromShown = lastShown.current ?? (ring.zone === "over" ? "ok" : ring.zone);
    const fromOwn = lastOwn.current ?? ownZone;
    lastShown.current = ring.zone;
    lastOwn.current = ownZone;
    if (reduceMotion || ignored || !ringWorsens(fromShown, ring.zone)) return;
    const previewWorse = ring.zone !== ownZone && ringWorsens(ownZone, ring.zone);
    const lineWorse = ring.zone === ownZone && (opening || ringWorsens(fromOwn, ownZone));
    if (!previewWorse && !lineWorse) return;
    void shake.start({ x: SHAKE_X_PX, transition: { duration: SHAKE_S, delay: opening ? turnS + FILL_S * OVER_SHAKE_AT : 0 } });
  }, [inView, ring.zone, ownZone, reduceMotion, ignored, shake, turnS]);

  // In range: a check grows in, then OK takes its place. Tapped: the count.
  /** Where a closing ring's centre is: still the count while the lap closes, the check, then OK. */
  const [closing, setClosing] = useState<"count" | "check" | "ok">("count");
  const okNow = zone === "ok" && !ignored && inView;
  // Out of range again: the next closing starts from the count. Adjusted while rendering, not in an effect.
  if (!okNow && closing !== "count") setClosing("count");
  const closedMs = (delayS + FILL_S) * MS_PER_S;
  useEffect(() => {
    if (!okNow || reduceMotion) return;
    const toCheck = setTimeout(() => setClosing("check"), closedMs);
    const toOk = setTimeout(() => setClosing("ok"), closedMs + CHECK_HOLD_MS);
    return () => {
      clearTimeout(toCheck);
      clearTimeout(toOk);
    };
  }, [okNow, reduceMotion, closedMs]);
  const centreState = reduceMotion ? "ok" : closing;

  const px = RING_PX[size];
  const stroke = STROKE_PX[size];
  const r = (px - stroke) / 2;
  const fill = (to: number) => ({
    // A round cap draws a dot at zero length: an empty lap is hidden instead.
    animate: { pathLength: inView ? to : 0, opacity: inView && to > 0 ? 1 : 0 },
    initial: { pathLength: 0, opacity: 0 },
    transition: { duration: reduceMotion ? 0 : FILL_S, ease: EASE_SINE, delay: delayS },
  });
  const arc = (className: string) => ({
    cx: px / 2,
    cy: px / 2,
    r,
    fill: "none",
    strokeWidth: stroke,
    strokeLinecap: "round" as const,
    className: cn("transition-[stroke] duration-500 motion-reduce:transition-none", className),
  });

  const moved = previewing ? after.value - line.value : 0;
  const Chevron = moved > 0 ? ChevronUp : ChevronDown;
  const better = moved !== 0 && towardTarget(line.value, line.target, moved, minimum, after?.target);
  const countClass = cn("font-mono leading-none", size === "lg" ? "text-xl" : size === "sm" ? "text-base" : "text-sm");
  const centreKey = ignored ? "ignored" : okNow && centreState !== "count" ? centreState : `count-${shown.value}`;
  const spoken = spokenRing(line, zone, minimum, previewing ? { value: after.value, better } : null);

  const ringBody = (
    <motion.span animate={pop} className="block">
      <motion.span animate={shake} className="relative block" style={{ width: px, height: px }}>
        <svg aria-hidden width={px} height={px} className="-rotate-90">
          <circle cx={px / 2} cy={px / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-seam" />
          <motion.circle {...arc(ignored ? "stroke-muted-foreground/50" : LAP_STROKE[zone])} {...fill(ring.lap)} />
          {!ignored && ring.extra > 0 && <motion.circle {...arc(EXTRA_STROKE[zone])} {...fill(ring.extra)} />}
        </svg>
        <span aria-hidden className="absolute inset-0 flex items-center justify-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={centreKey}
              initial={reduceMotion ? false : { opacity: 0, scale: centreKey === "check" ? RING_CHECK_GROW[0] : CENTRE_SWAP_SCALE }}
              animate={{ opacity: 1, scale: centreKey === "check" ? RING_CHECK_GROW : 1 }}
              exit={{ opacity: 0, scale: CENTRE_SWAP_SCALE }}
              transition={{ duration: reduceMotion ? 0 : CENTRE_SWAP_S, ease: "easeOut" }}
              className={cn("flex items-center justify-center", ignored ? "text-muted-foreground" : COUNT_TEXT[zone])}
            >
              {centreKey === "check" ? (
                <Check className={size === "lg" ? "size-7" : "size-5"} strokeWidth={3} />
              ) : centreKey === "ok" ? (
                <span className={cn("font-semibold", size === "lg" ? "text-base" : "text-sm")}>OK</span>
              ) : (
                <span className={countClass}>{shown.value}</span>
              )}
            </motion.span>
          </AnimatePresence>
        </span>
        {/* Over its range: the warning sits on the ring's shoulder. */}
        {zone === "over" && !ignored && (
          <TriangleAlert
            aria-hidden
            className="absolute -top-1 -right-1 size-4 rounded-full bg-background text-destructive"
            strokeWidth={2.5}
          />
        )}
        {moved !== 0 && (
          <span
            aria-hidden
            className={cn(
              "absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-background shadow-sm",
              better ? "text-success" : "text-destructive",
            )}
          >
            <Chevron className="size-4" strokeWidth={3} />
          </span>
        )}
      </motion.span>
    </motion.span>
  );

  const label =
    size === "mana" ? (
      <Image
        src={MANA_SYMBOL_URL(line.key.replace("sources:", ""))}
        alt=""
        width={SYMBOL_PX}
        height={SYMBOL_PX}
        unoptimized
        className="size-4"
      />
    ) : (
      <span className="line-clamp-2 text-xs leading-tight">{line.label}</span>
    );
  const range = ringRange(line.target, minimum);
  const tip = ringTip({
    group: line.group,
    label: line.label,
    value: line.value,
    low: range.low,
    high: range.high,
    zone: ignored ? "low" : ownZone,
    ignored,
    preview: previewing ? { value: after.value, zone: statRing(after.value, after.target, after.ok, minimum).zone, better } : undefined,
  });

  return (
    <li ref={box} className="flex min-w-0 flex-col items-center gap-0.5 text-center">
      <RingTip tip={tip} extra={tipExtra} action={action} spoken={spoken}>
        {ringBody}
      </RingTip>
      <span aria-hidden className={cn("flex items-start justify-center", ignored && "text-muted-foreground")}>
        {label}
      </span>
      {/* An ignored line is grey: the mark says why, as everywhere else in Deck stats. */}
      {ignored && <Mark state="ignored" />}
    </li>
  );
}

/**
 * The ring as the trigger of its tip: a hover opens it after a moment, a tap or Enter opens and closes it, and it stays
 * up while the pointer moves onto it, so its Fix can be reached.
 */
function RingTip({
  tip,
  extra,
  action,
  spoken,
  children,
}: {
  tip: string;
  extra: string | undefined;
  action: ReactNode;
  spoken: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  const later = (next: boolean, ms: number) => {
    clear();
    timer.current = window.setTimeout(() => setOpen(next), ms);
  };
  useEffect(() => clear, []);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        aria-label={spoken}
        onPointerEnter={(e) => e.pointerType === "mouse" && later(true, TIP_HOVER_DELAY_MS)}
        onPointerLeave={(e) => e.pointerType === "mouse" && later(false, TIP_LEAVE_MS)}
        className="cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={16}
          // A tip leaves focus where it was, so the swipe keys keep working.
          onOpenAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={(e) => e.pointerType === "mouse" && clear()}
          onPointerLeave={(e) => e.pointerType === "mouse" && later(false, TIP_LEAVE_MS)}
          className="z-50 flex max-w-64 flex-col items-start gap-1 rounded-lg border border-seam bg-sleeve px-3 py-2 text-sm text-foreground shadow-lift"
        >
          <p>{tip}</p>
          {extra && <p className="text-xs text-muted-foreground">{extra}</p>}
          {action && <span className="flex flex-wrap items-center gap-x-2 text-xs">{action}</span>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** As many rings to a row as fit, each column just wider than its ring, so a row reads in one sweep. */
const GRID: Record<RingSize, string> = {
  lg: "grid-cols-[repeat(auto-fill,minmax(5rem,1fr))]",
  sm: "grid-cols-[repeat(auto-fill,minmax(4rem,1fr))]",
  mana: "grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))]",
};

/**
 * Every line as rings, by group, each under a small heading: the main lines (mana and roles) big, the card types
 * smaller, the colour sources by their mana symbol. Finish shows the deck this way; the Deck stats sheet places the
 * groups among its other parts itself.
 */
export function StatRingGroups({ lines, actionFor }: { lines: readonly StatLine[]; actionFor?: (line: StatLine) => ReactNode }) {
  const groups: { title: string; size: RingSize; lines: StatLine[] }[] = [
    { title: "Mana and roles", size: "lg", lines: lines.filter((l) => l.group === "mana" || l.group === "roles") },
    { title: "Types", size: "sm", lines: lines.filter((l) => l.group === "types") },
    { title: "Colour sources", size: "mana", lines: lines.filter((l) => l.group === "colours") },
  ];
  return (
    <div className="flex flex-col gap-3">
      {groups
        .filter((g) => g.lines.length > 0)
        .map((g) => (
          <section key={g.title} className="flex flex-col gap-1.5">
            <h4 className="text-sm font-semibold text-muted-foreground">{g.title}</h4>
            <StatRings label={g.title} lines={g.lines} size={g.size} {...(actionFor ? { actionFor } : {})} />
          </section>
        ))}
    </div>
  );
}

/** A group of rings in a grid: big for the main lines, smaller for the card types, mana symbols for the colours. */
export function StatRings({
  lines,
  size,
  afterFor,
  actionFor,
  tipExtraFor,
  label,
}: {
  lines: readonly StatLine[];
  size: RingSize;
  afterFor?: (line: StatLine) => StatLine | undefined;
  actionFor?: (line: StatLine) => ReactNode;
  /** A second paragraph for a ring's tip. */
  tipExtraFor?: (line: StatLine) => string | undefined;
  label: string;
}) {
  if (lines.length === 0) return null;
  return (
    <ul aria-label={label} className={cn("grid gap-x-1 gap-y-2.5", GRID[size])}>
      {lines.map((line, i) => (
        <StatRing key={line.key} line={line} after={afterFor?.(line)} size={size} index={i} action={actionFor?.(line)} tipExtra={tipExtraFor?.(line)} />
      ))}
    </ul>
  );
}
