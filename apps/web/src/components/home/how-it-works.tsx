import { Fragment, type ReactNode } from "react";
import { ArrowRight, ChevronRight } from "lucide-react";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";
import { CardImage } from "@/components/cards/card-image";
import { Band } from "@/components/ui/band";
import { Panel } from "@/components/ui/panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { sampleCard } from "@/lib/sample-cards";

const HOW_IT_WORKS_BLURB =
  "It's exhausting scrolling sites like Moxfield and EDHREC, seeing awesome decks and being unsure what to swap in where. Whether you want to tune up your own deck, build a netdeck from the cards you already own, or have us assemble a starting point around the cool legendary you just pulled, we've got you covered.";

/** Thumbnails in the vignettes render at about 48 px, well inside Scryfall's `small`. */
const THUMB_SIZES = "48px";

/** Step 1: a few cards out of a binder, each with how many you own. Offsets fan them like a loose pile. */
const COLLECTION_PILE: { card: CardSummary; owned: number; className: string }[] = [
  { card: sampleCard("Swords to Plowshares"), owned: 3, className: "-rotate-6 translate-y-1" },
  { card: sampleCard("Sol Ring"), owned: 2, className: "z-10 -translate-y-1" },
  { card: sampleCard("Command Tower"), owned: 4, className: "rotate-6 translate-y-1" },
];

/** Step 2: the start of a list exactly as a player pastes it, one "quantity name" per line. */
const DECKLIST_LINES = [
  "1 Chulane, Teller of Tales",
  "1 Sol Ring",
  "1 Rhystic Study",
  "1 Cultivate",
];

/** Step 3: one card of each job, marked along the top edge in the job's colour (the artist line stays clear). */
const CUT_CARD = sampleCard("Mind Stone");
const ADD_CARD = sampleCard("Guardian Project");
const REPLACE_FROM = sampleCard("Three Visits");
const REPLACE_TO = sampleCard("Farseek");

/** `width` is a Tailwind width class; thumbnails default to 48 px. */
function Thumb({ card, width = "w-12", className }: { card: CardSummary; width?: string; className?: string }) {
  return (
    <div className={cn("shrink-0", width, className)}>
      <CardImage card={card} variant="small" sizes={THUMB_SIZES} alt="" />
    </div>
  );
}

function CollectionVignette() {
  return (
    <div className="flex items-center justify-center -space-x-4">
      {COLLECTION_PILE.map(({ card, owned, className }) => (
        <div key={card.name} className={cn("relative", className)}>
          <Thumb card={card} />
          <span className="absolute -top-2 -right-2 rounded-sm border border-seam bg-background px-1 text-[0.625rem] font-bold tabular-nums text-primary">
            ×{owned}
          </span>
        </div>
      ))}
    </div>
  );
}

function DecklistVignette() {
  return (
    <div className="w-full max-w-[11.5rem] rotate-[-1.5deg] rounded-sm border border-seam bg-sleeve px-2.5 py-1.5 text-left text-[0.6875rem] leading-snug text-foreground/80 shadow-[0_8px_18px_-10px_rgb(0_0_0/0.8)]">
      {DECKLIST_LINES.map((line) => (
        <p key={line} className="truncate">
          {line}
        </p>
      ))}
    </div>
  );
}

/** A card with its job's colour along the top edge. */
function Marked({ card, tone }: { card: CardSummary; tone: "cut" | "add" | "replace" }) {
  const bar = { cut: "bg-cut", add: "bg-add", replace: "bg-replace" }[tone];
  return (
    <div className="flex flex-col gap-1">
      <span className={cn("h-1 rounded-full", bar)} />
      <Thumb card={card} width="w-9" />
    </div>
  );
}

function JobsVignette() {
  return (
    <div className="flex items-end justify-center gap-1.5">
      <Marked card={CUT_CARD} tone="cut" />
      <Marked card={ADD_CARD} tone="add" />
      <div className="flex items-center gap-1">
        <Marked card={REPLACE_FROM} tone="replace" />
        <ArrowRight aria-hidden className="size-3 shrink-0 text-replace" />
        <Marked card={REPLACE_TO} tone="replace" />
      </div>
    </div>
  );
}

const STEPS: { step: number; title: string; desc: string; vignette: ReactNode }[] = [
  {
    step: 1,
    title: "Import your collection",
    desc: "Via text, CSV, or from the most popular web apps.",
    vignette: <CollectionVignette />,
  },
  {
    step: 2,
    title: "Add your decklist",
    desc: "Either your own or from your favorite site.",
    vignette: <DecklistVignette />,
  },
  {
    step: 3,
    title: "Cut/Add/Replace",
    desc: "Tailored recommendations to swap out expensive cards or improve your existing deck with the cards you already own.",
    vignette: <JobsVignette />,
  },
];

/**
 * The three steps, each shown as what the player actually handles at that step (a pile of owned cards, a pasted
 * list, the cut/add/replace marks) above the words. The steps are a real sequence, hence the numbers and chevrons.
 */
export function HowItWorks() {
  return (
    <Band
      aria-labelledby="how-it-works"
      inner="grid gap-6 py-10 md:py-12 lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-10"
    >
      <div>
        <SectionHeading id="how-it-works" eyebrow="How it works">
          No more sifting through chaff
        </SectionHeading>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted-foreground">{HOW_IT_WORKS_BLURB}</p>
      </div>
      <div role="list" className="flex flex-col gap-3 md:flex-row md:items-stretch md:gap-1.5">
        {STEPS.map(({ step, title, desc, vignette }, i) => (
          <Fragment key={step}>
            <Panel role="listitem" padding="none" surface="table" className="flex flex-1 flex-col overflow-hidden">
              {/* The vignette is illustration; the heading and sentence below carry the meaning. */}
              <div aria-hidden className="flex h-24 items-center justify-center border-b border-seam px-3">
                {vignette}
              </div>
              <div className="flex gap-2 px-4 py-3.5">
                <span aria-hidden className="text-[0.9375rem] leading-snug font-bold text-primary tabular-nums">
                  {step}.
                </span>
                <div>
                  <h3 className="text-[0.9375rem] leading-snug font-bold">{title}</h3>
                  <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted-foreground">{desc}</p>
                </div>
              </div>
            </Panel>
            {i < STEPS.length - 1 && (
              <div aria-hidden className="hidden shrink-0 items-center justify-center text-muted-foreground md:flex">
                <ChevronRight className="size-3.5" />
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </Band>
  );
}
