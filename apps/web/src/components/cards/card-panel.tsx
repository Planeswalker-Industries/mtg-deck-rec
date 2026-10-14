"use client";

import { useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Check, Minus, Plus, X, type LucideIcon } from "lucide-react";
import type { CardFace, CardRules, CardSummary } from "@mtg/core/contract";
import type { CompareMark } from "@mtg/core/journey";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/cards";
import { CardImage } from "./card-image";
import { ZoomableCard } from "./card-zoom";
import { ManaCost } from "./mana-cost";
import { RulesText } from "./rules-text";

/** Rules text lines shown before "More": a whole card on the single panel, the gist on a compact one. */
const CLAMP = { single: "line-clamp-6", compact: "line-clamp-2" } as const;
/** Rules text longer than this many characters gets "More"; shorter text always fits the clamp. */
const CLAMP_CHARS = { single: 220, compact: 70 } as const;
/** Placeholder lines while a card's rules are on their way. */
const LOADING_LINES = { single: 4, compact: 2 } as const;

type Size = keyof typeof CLAMP;

/** "2/1", "Loyalty 4", "Defense 3": the printed stat in the card's lower right, or null when it has none. */
export function printedStat(stats: Pick<CardFace, "power" | "toughness" | "loyalty" | "defense">): string | null {
  if (stats.power != null && stats.toughness != null) return `${stats.power}/${stats.toughness}`;
  if (stats.loyalty != null) return `Loyalty ${stats.loyalty}`;
  if (stats.defense != null) return `Defense ${stats.defense}`;
  return null;
}

/** The text of a card: each face's when it has several, so a double-faced card reads front then back. */
function RulesBlock({ rules, size }: { rules: CardRules | null | undefined; size: Size }) {
  const [open, setOpen] = useState(false);
  if (rules === undefined) {
    return (
      <div role="status" aria-label="Loading rules text" className="flex flex-col gap-1.5 pt-0.5">
        {Array.from({ length: LOADING_LINES[size] }, (_, i) => (
          <Skeleton key={i} className={cn("h-3.5 bg-seam", i === LOADING_LINES[size] - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    );
  }
  if (rules === null) return null;
  const faces = rules.faces ?? [];
  const text = faces.length > 0 ? faces.map((f) => f.oracleText).join("\n") : (rules.oracleText ?? "");
  if (text.trim() === "") return null;
  const long = text.length > CLAMP_CHARS[size];
  return (
    <div className="text-sm leading-snug">
      <div className={cn("flex flex-col gap-1.5 whitespace-pre-line", long && !open && CLAMP[size])}>
        {faces.length > 0 ? (
          faces.map((face, i) => (
            <p key={i}>
              {i > 0 && <span className="font-semibold">{face.name}: </span>}
              <RulesText text={face.oracleText} />
            </p>
          ))
        ) : (
          <p>
            <RulesText text={text} />
          </p>
        )}
      </div>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="relative mt-1 cursor-pointer text-sm font-semibold text-primary after:absolute after:-inset-2 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/**
 * What a card is and says, beside its image: name and cost, type line and printed stat, then the rules text. `children`
 * goes under it: why the card is here, its play rate, its price.
 */
function CardFacts({ card, rules, size, tag, children }: { card: CardSummary; rules: CardRules | null | undefined; size: Size; tag?: ReactNode; children?: ReactNode }) {
  const stat = rules ? printedStat(rules) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {tag}
      <div className="flex items-start justify-between gap-2">
        <p className={cn("min-w-0 font-heading leading-tight font-semibold text-balance", size === "single" ? "text-lg" : "text-base")}>
          {displayName(card)}
        </p>
        <ManaCost cost={card.manaCost} className="mt-0.5 text-sm" />
      </div>
      <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{card.typeLine}</span>
        {stat && <span className="shrink-0 rounded border border-seam px-1.5 font-mono text-sm text-foreground">{stat}</span>}
      </p>
      <div aria-hidden className="h-px bg-seam" />
      <RulesBlock rules={rules} size={size} />
      {children && <div className="mt-auto flex flex-col gap-0.5 pt-1 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * One card in full, the way a binder page shows it: the image on the left (tap to enlarge; nothing is drawn over it, so
 * the artist line stays visible), what it says on the right. Replaces the big swipe card, so a card can be judged
 * without opening anything.
 */
export function CardPanel({ card, rules, children }: { card: CardSummary; rules: CardRules | null | undefined; children?: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <ZoomableCard card={card}>
        <CardImage card={card} variant="normal" alt={card.name} sizes="(max-width: 640px) 40vw, 208px" eager />
      </ZoomableCard>
      <CardFacts card={card} rules={rules} size="single">
        {children}
      </CardFacts>
    </div>
  );
}

/** Out or In on a swap's compact rows: the job's colour, always with its icon and word. */
function SwapTag({ side }: { side: "out" | "in" }) {
  const Icon = side === "out" ? Minus : Plus;
  return (
    <span className={cn("inline-flex w-fit items-center gap-1 text-xs font-semibold", side === "out" ? "text-cut" : "text-add")}>
      <Icon aria-hidden className="size-3.5" strokeWidth={2.75} />
      {side === "out" ? "In your deck" : "Swap in"}
    </span>
  );
}

/** A smaller panel for one side of a swap: two of these stack on a phone with room for the buttons. */
export function CompactCardPanel({
  card,
  rules,
  side,
  dim = false,
  children,
}: {
  card: CardSummary;
  rules: CardRules | null | undefined;
  side: "out" | "in";
  /** The card going out reads quieter than the one coming in. */
  dim?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)] items-start gap-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
      <ZoomableCard card={card}>
        <CardImage
          card={card}
          variant="normal"
          alt={`${side === "out" ? "In your deck" : "Replacement"}: ${card.name}`}
          sizes="(max-width: 640px) 28vw, 136px"
          eager
          className={dim ? "opacity-80 saturate-50" : undefined}
        />
      </ZoomableCard>
      <CardFacts card={card} rules={rules} size="compact" tag={<SwapTag side={side} />}>
        {children}
      </CardFacts>
    </div>
  );
}

/** How a replacement compares, as loot-style marks: green with an up arrow when better, red with a down arrow when worse. */
export function CompareMarks({ marks, label }: { marks: readonly CompareMark[]; label: string }) {
  if (marks.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {marks.map((mark) => {
        const better = mark.tone === "better";
        const Icon = better ? ArrowUp : ArrowDown;
        return (
          <li
            key={mark.key}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
              better ? "border-success/40 bg-success/10 text-success" : "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            <Icon aria-hidden className="size-3.5" strokeWidth={2.75} />
            <span>
              <span className="sr-only">{better ? "Better: " : "Worse: "}</span>
              {mark.label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** The accept button's fill: the job's own colour for a cut or an add, the accent for a swap. */
const ACCEPT_FILL = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  cut: "bg-cut text-background hover:bg-cut/90",
  add: "bg-add text-background hover:bg-add/90",
} as const;

export type DecisionTone = keyof typeof ACCEPT_FILL;

/**
 * The two answers to a card, as labelled buttons under it: pass on the left (a blue outline), accept on the right (the
 * job's colour). Each names its card for screen readers ("Cut Sol Ring"); the visible word is short.
 */
export function DecisionButtons({
  tone,
  pass,
  accept,
  disabled = false,
}: {
  tone: DecisionTone;
  pass: { word: string; label: string; icon?: LucideIcon; onClick: () => void };
  accept: { word: string; label: string; icon?: LucideIcon; onClick: () => void };
  disabled?: boolean;
}) {
  const PassIcon = pass.icon ?? X;
  const AcceptIcon = accept.icon ?? Check;
  const base =
    "flex h-12 items-center justify-center gap-2 rounded-lg text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-40";
  return (
    <div className="grid grid-cols-2 gap-2">
      <button type="button" aria-label={pass.label} title={pass.label} disabled={disabled} onClick={pass.onClick} className={cn(base, "border-2 border-primary/70 text-primary hover:bg-primary/10")}>
        <PassIcon aria-hidden className="size-5" strokeWidth={2.75} />
        {pass.word}
      </button>
      <button type="button" aria-label={accept.label} title={accept.label} disabled={disabled} onClick={accept.onClick} className={cn(base, ACCEPT_FILL[tone])}>
        <AcceptIcon aria-hidden className="size-5" strokeWidth={2.75} />
        {accept.word}
      </button>
    </div>
  );
}
