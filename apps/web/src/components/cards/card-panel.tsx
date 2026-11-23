"use client";

import { useState, type ReactNode } from "react";
import { Check, X, type LucideIcon } from "lucide-react";
import type { CardFace, CardRules, CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { displayName } from "@/lib/cards";
import { CardImage } from "./card-image";
import { ZoomableCard } from "./card-zoom";
import { ManaCost } from "./mana-cost";
import { OwnedCorner } from "./owned-corner";
import { RulesText } from "./rules-text";

/**
 * Rules text lines shown before "More". A phone shows fewer, so the swipe buttons stay above the Deck stats footer at
 * 390×844 with a wordy card.
 */
const PHONE_CLAMP = "max-sm:line-clamp-4";
const CLAMP = `${PHONE_CLAMP} sm:line-clamp-6`;
/** Rules text longer than this many characters gets "More"; shorter text always fits the clamp. */
const CLAMP_CHARS = 220;
/** The same on a phone's narrower column, where fewer characters fill the clamp. */
const PHONE_CLAMP_CHARS = 90;
/** Placeholder lines while a card's rules are on their way. */
const LOADING_LINES = 4;

/** "2/1", "Loyalty 4", "Defense 3": the printed stat in the card's lower right, or null when it has none. */
export function printedStat(stats: Pick<CardFace, "power" | "toughness" | "loyalty" | "defense">): string | null {
  if (stats.power != null && stats.toughness != null) return `${stats.power}/${stats.toughness}`;
  if (stats.loyalty != null) return `Loyalty ${stats.loyalty}`;
  if (stats.defense != null) return `Defense ${stats.defense}`;
  return null;
}

/** The text of a card: each face's when it has several, so a double-faced card reads front then back. */
function RulesBlock({ rules }: { rules: CardRules | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (rules === undefined) {
    return (
      <div role="status" aria-label="Loading rules text" className="flex flex-col gap-1.5 pt-0.5">
        {Array.from({ length: LOADING_LINES }, (_, i) => (
          <Skeleton key={i} className={cn("h-3.5 bg-seam", i === LOADING_LINES - 1 ? "w-2/3" : "w-full")} />
        ))}
      </div>
    );
  }
  if (rules === null) return null;
  const faces = rules.faces ?? [];
  const text = faces.length > 0 ? faces.map((f) => f.oracleText).join("\n") : (rules.oracleText ?? "");
  if (text.trim() === "") return null;
  const long = text.length > CLAMP_CHARS;
  const longOnPhone = text.length > PHONE_CLAMP_CHARS;
  return (
    <div className="text-sm leading-snug">
      <div
        className={cn(
          "flex flex-col gap-1.5 whitespace-pre-line",
          !open && (long ? CLAMP : longOnPhone && PHONE_CLAMP),
        )}
      >
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
      {(long || longOnPhone) && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(!long && "sm:hidden", "relative mt-1 cursor-pointer text-sm font-semibold text-primary after:absolute after:-inset-2 after:content-[''] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary")}
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
function CardFacts({ card, rules, children }: { card: CardSummary; rules: CardRules | null | undefined; children?: ReactNode }) {
  const stat = rules ? printedStat(rules) : null;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 font-heading text-lg leading-tight font-semibold text-balance">{displayName(card)}</p>
        <ManaCost cost={card.manaCost} className="mt-0.5 text-sm" />
      </div>
      <p className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{card.typeLine}</span>
        {stat && <span className="shrink-0 rounded border border-seam px-1.5 font-mono text-sm text-foreground">{stat}</span>}
      </p>
      <div aria-hidden className="h-px bg-seam" />
      <RulesBlock rules={rules} />
      {children && <div className="mt-auto flex flex-col gap-0.5 pt-1 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/**
 * One card in full, the way a binder page shows it: the image on the left (tap to enlarge; only the owned marker, in
 * the top corner, is drawn over it, so the artist line stays visible), what it says on the right. Replaces the big
 * swipe card, so a card can be judged without opening anything.
 */
export function CardPanel({
  card,
  rules,
  owned = false,
  children,
}: {
  card: CardSummary;
  rules: CardRules | null | undefined;
  /** Marks the card as owned (`OwnedCorner`). */
  owned?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4">
      <div className="relative">
        <ZoomableCard card={card}>
          <CardImage card={card} variant="normal" alt={card.name} sizes="(max-width: 640px) 40vw, 208px" eager />
        </ZoomableCard>
        {owned && <OwnedCorner />}
      </div>
      <CardFacts card={card} rules={rules}>
        {children}
      </CardFacts>
    </div>
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
