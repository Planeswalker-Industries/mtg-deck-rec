"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Minus, Plus } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import type { FixMove } from "@mtg/core/journey";
import { cn } from "cn";
import { DecisionButtons } from "@/components/cards/card-panel";
import { CardImage } from "@/components/cards/card-image";
import { ZoomableCard } from "@/components/cards/card-zoom";
import { OwnedCorner } from "@/components/cards/owned-corner";
import { Button } from "@/components/ui/button";
import { displayName } from "@/lib/cards";
import { formatAsOf, formatUsd } from "@/lib/format";
import { StatChips } from "../deck-stats/stat-chips";
import { useStatPreview } from "../deck-stats/stat-preview";
import { PanelError } from "../panel-state";
import { ShuffleDeck } from "../shuffle-deck";
import { SWIPE_COOLDOWN_MS } from "../swipe-rater";
import { FixAutoSheet } from "./fix-auto-sheet";
import { PhaseIntro } from "./journey-stepper";
import { SwipeDone } from "./single-swipe";
import type { DeckJourney } from "./use-deck-journey";
import type { Fix, FixLineLabel } from "./use-fix";

/** "Ramp 10/14": the line's name with its count against the target as shown, where it has one. */
function LineCount({ line }: { line: FixLineLabel }) {
  return (
    <span className="min-w-0">
      <span className="font-semibold text-foreground">{line.label}</span>
      {line.value !== undefined && line.target !== undefined && (
        <span className="font-mono">
          {" "}
          <span className="text-warning">{line.value}</span>/{Math.round(line.target)}
        </span>
      )}
    </span>
  );
}

/** One side of a move: Out or In in its job's colour (with its icon and word), the card, and its name. */
function MoveCard({ card, side, owned, note }: { card: CardSummary; side: "out" | "in"; owned?: boolean; note?: string | null }) {
  const Icon = side === "out" ? Minus : Plus;
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", side === "out" ? "text-cut" : "text-add")}>
        <Icon aria-hidden className="size-3.5" strokeWidth={2.75} />
        {side === "out" ? "Out" : "In"}
      </span>
      {/* The width is capped so both cards, the chips and the buttons fit a phone above the Deck stats footer. */}
      <div className="relative w-full max-w-28 sm:max-w-52">
        <ZoomableCard card={card}>
          <CardImage
            card={card}
            variant="normal"
            alt={`${side === "out" ? "Out" : "In"}: ${card.name}`}
            sizes="(max-width: 640px) 40vw, 208px"
            eager
            className={side === "out" ? "opacity-80 saturate-50" : undefined}
          />
        </ZoomableCard>
        {owned && <OwnedCorner />}
      </div>
      <p className="w-full text-center text-sm leading-tight font-semibold text-balance">{displayName(card)}</p>
      {note && <p className="text-center font-mono text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/**
 * Fix: one paired move at a time, a card out on the left and a card in on the right, for the Deck stats line named in
 * the header. Swap makes the move, Skip passes on the pair (either card may come back in another), and "Fix the rest
 * for me" previews every move left to apply together. The chips under the cards name every line the move changes.
 */
export function FixPhase({ journey, fix, hasCollection }: { journey: DeckJourney; fix: Fix; hasCollection: boolean }) {
  const { move } = fix;
  const lastAt = useRef(0);
  /** The plan the auto-fix sheet previews, made when it is asked for; null while the sheet is shut. */
  const [plan, setPlan] = useState<FixMove[] | null>(null);
  useStatPreview(move?.in ?? null, move?.out ?? null);

  // A double tap would otherwise answer the pair that just came up, which the player never saw.
  const act = (accept: boolean) => {
    if (!move || plan !== null || Date.now() - lastAt.current < SWIPE_COOLDOWN_MS) return;
    lastAt.current = Date.now();
    if (accept) fix.accept();
    else fix.skip();
  };

  // Arrow keys do what the buttons do, unless the player is typing somewhere.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      e.preventDefault();
      act(e.key === "ArrowRight");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const intro = (
    <PhaseIntro title="Fix" brief="Swap one card for another to bring a Deck stats line in line.">
      One card out, one card in, until every Deck stats line is in line.
    </PhaseIntro>
  );
  const toNext = journey.nextStep;

  if (fix.status === "loading" || fix.status === "idle") {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <ShuffleDeck label="Checking the deck against its stats" />
      </div>
    );
  }
  if (fix.status === "error") {
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <PanelError message={fix.message ?? "Couldn't load the cards for Fix."} />
      </div>
    );
  }

  if (!move) {
    const fixed = journey.state?.fixes.length ?? 0;
    const left = fix.lines.length;
    return (
      <div className="flex flex-col gap-3">
        {intro}
        <SwipeDone
          title={left === 0 ? "Every line is in line" : fixed > 0 ? "That's every move" : "Nothing to fix here"}
          message={
            left === 0
              ? fixed > 0
                ? `${fixed} ${fixed === 1 ? "card" : "cards"} swapped. Next, swap weaker cards for better ones.`
                : "Next, swap weaker cards for better ones."
              : `${left} ${left === 1 ? "line has" : "lines have"} no move left. Finish says why for each.`
          }
        >
          <Button type="button" size="lg" onClick={toNext}>
            Next: swap
          </Button>
        </SwipeDone>
      </div>
    );
  }

  const inCard = fix.inCard;
  const notOwned = inCard !== null && hasCollection && inCard.owned === null;
  const price = move.in.price;
  const outName = displayName(move.out);
  const inName = displayName(move.in);

  return (
    <div className="flex flex-col gap-3">
      {intro}
      <p role="status" className="flex items-baseline justify-between gap-3 text-sm text-muted-foreground">
        <LineCount line={fix.lineLabel(move.line)} />
        <span className="shrink-0 font-mono">
          line {fix.position} of {fix.total}
        </span>
      </p>
      <section aria-label="Fix: one card out, one card in" className="playmat mx-auto flex w-full max-w-2xl flex-col gap-3">
        <div aria-live="polite" className="grid grid-cols-2 items-start gap-3">
          <MoveCard card={move.out} side="out" />
          <MoveCard
            card={move.in}
            side="in"
            owned={hasCollection && inCard !== null && inCard.owned !== null}
            note={notOwned ? `Not owned · ${price ? `about ${formatUsd(price.usd)}` : "no price"}` : null}
          />
        </div>
        <StatChips add={move.in} remove={move.out} all className="justify-center" />
        <DecisionButtons
          tone="primary"
          pass={{ word: "Skip", label: `Skip swapping ${outName} for ${inName}`, onClick: () => act(false) }}
          accept={{ word: "Swap", label: `Swap ${outName} for ${inName}`, icon: ArrowLeftRight, onClick: () => act(true) }}
        />
        <div className="-mt-1 flex flex-wrap justify-center gap-2">
          <Button type="button" size="sm" variant="link" onClick={() => setPlan(fix.plan())}>
            Fix the rest for me
          </Button>
        </div>
        {notOwned && price && <p className="text-center text-xs text-muted-foreground">Prices are Scryfall estimates from {formatAsOf(price.asOf)}.</p>}
      </section>
      {plan !== null && (
        <FixAutoSheet
          moves={plan}
          lineLabel={(line) => fix.lineLabel(line).label}
          scoreWith={fix.scoreWith}
          onCancel={() => setPlan(null)}
          onApply={(chosen) => {
            setPlan(null);
            fix.applyPlan(chosen);
          }}
        />
      )}
    </div>
  );
}
