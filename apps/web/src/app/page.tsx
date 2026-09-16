import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Plus, Repeat2, Scissors } from "lucide-react";
import { mockCards } from "@mtg/core/mocks";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { buttonVariants } from "@/components/ui/button";
import { getHeroArt } from "@/lib/server/recs-cache";

function sampleCard(name: string): CardSummary {
  const card = mockCards.find((c) => c.name === name);
  if (!card) throw new Error(`Sample card missing from fixtures: ${name}`);
  return card;
}

/**
 * A hand fanned out on the table, commander in the middle and lit from above.
 * `lift` raises a card toward the light; the outermost cards are dealt last.
 */
type FanCard = {
  card: CardSummary;
  rotate: number;
  x: string;
  y: string;
  scale: number;
  /** Hidden on phones, where only the middle three fit. */
  wide?: boolean;
};

const FAN: FanCard[] = [
  { card: sampleCard("Cultivate"), rotate: -22, x: "-64%", y: "10%", scale: 0.86, wide: true },
  { card: sampleCard("Rhystic Study"), rotate: -11, x: "-33%", y: "3%", scale: 0.93 },
  { card: sampleCard("Chulane, Teller of Tales"), rotate: 0, x: "0%", y: "-4%", scale: 1 },
  { card: sampleCard("Counterspell"), rotate: 11, x: "33%", y: "3%", scale: 0.93 },
  { card: sampleCard("Birds of Paradise"), rotate: 22, x: "64%", y: "10%", scale: 0.86, wide: true },
];
const FAN_SIZES = "(min-width: 768px) 220px, 42vw";
/** The card at the centre of the fan, so the credit names what people are actually looking at. */
const HERO_SLUG = "chulane-teller-of-tales";

const jobs = [
  {
    name: "Cut",
    summary: "Weak links",
    body: "Cards that cost too much for what they do, sit outside your colors, or push the deck past its bracket.",
    Icon: Scissors,
    tone: "text-cut",
    rule: "bg-cut",
  },
  {
    name: "Add",
    summary: "Missing pieces",
    body: "What decks with your commander play that yours doesn't, grouped by the job each card does.",
    Icon: Plus,
    tone: "text-add",
    rule: "bg-add",
  },
  {
    name: "Replace",
    summary: "Another way to do the job",
    body: "Tap any card to see what else does its job, how the two compare, and what the swap costs.",
    Icon: Repeat2,
    tone: "text-replace",
    rule: "bg-replace",
  },
];

async function HeroArt() {
  const hero = await getHeroArt(HERO_SLUG);
  if (!hero) return null;
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <Image src={hero.art} alt="" fill unoptimized priority className="object-cover object-center" />
        {/* The headline sits on the left, so the wash is heaviest there and thins out under the cards. */}
        <div className="absolute inset-0 bg-background/35" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-background/45" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/40" />
      </div>
      <p className="relative mt-8 text-xs text-muted-foreground">
        Art from{" "}
        <Link href={`/card/${hero.slug}`} className="underline underline-offset-2 hover:text-foreground">
          {hero.name}
        </Link>{" "}
        by {hero.artist}
      </p>
    </>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-10 pb-6 md:gap-12">
      {/* The light falls here, at the top of the table. */}
      <section className="relative -mx-4 overflow-x-clip px-4 pt-6 pb-2 md:pt-10 md:pb-4">

        <div className="relative grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:items-center md:gap-8">
          {/* Cards come first on a phone: they say what this is faster than any sentence. */}
          <div aria-hidden className="order-first md:order-last">
            <div className="relative mx-auto h-[15.5rem] w-[10.5rem] sm:h-[18rem] sm:w-[10rem] md:h-[18.5rem] md:w-[10.5rem]">
              {FAN.map((pocket, i) => (
                <div
                  key={pocket.card.name}
                  className={`fan-card absolute inset-0 ${pocket.wide ? "hidden sm:block" : ""}`}
                  style={
                    {
                      "--r": `${pocket.rotate}deg`,
                      "--x": pocket.x,
                      "--y": pocket.y,
                      "--s": pocket.scale,
                      "--delay": `${60 + Math.abs(i - 2) * 90}ms`,
                      zIndex: 10 - Math.abs(i - 2),
                    } as React.CSSProperties
                  }
                >
                  <CardImage
                    card={pocket.card}
                    alt=""
                    sizes={FAN_SIZES}
                    eager
                    className="shadow-[0_18px_40px_-16px_rgb(0_0_0/0.9)]"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="max-w-xl">
            <h1 className="font-heading text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.015em] text-balance sm:text-6xl">
              Tune the deck you already own.
            </h1>
            <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
              Paste a decklist and see which cards to cut, what your commander’s decks are missing, and which
              cards do the same job for less.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/deck"
                className={buttonVariants({ size: "lg", className: "lit h-12 px-6 text-base font-bold" })}
              >
                Paste a decklist
              </Link>
              <Link
                href="/collection"
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: "h-12 px-6 text-base font-bold",
                })}
              >
                Browse your collection
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">No account needed.</p>
          </div>
        </div>

        {/* Null while it loads and null if it fails, so the landing page never waits on the database. */}
        <Suspense fallback={null}>
          <HeroArt />
        </Suspense>
      </section>

      <section aria-label="What the deck tool shows you" className="grid gap-px overflow-hidden rounded-xl bg-seam sm:grid-cols-3">
        {jobs.map(({ name, summary, body, Icon, tone, rule }) => (
          <div key={name} className="relative bg-sleeve p-5 sm:p-6">
            <span aria-hidden className={`absolute inset-x-0 top-0 h-px ${rule}`} />
            <div className="flex items-baseline gap-2.5">
              <Icon aria-hidden className={`size-5 shrink-0 translate-y-0.5 ${tone}`} strokeWidth={2.5} />
              <h2 className="font-heading text-2xl leading-none font-semibold">{name}</h2>
              <p className={`text-sm font-bold ${tone}`}>{summary}</p>
            </div>
            <p className="mt-3 max-w-prose leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-seam bg-sleeve/60 p-5 sm:p-7">
        <h2 className="font-heading text-2xl leading-tight font-semibold">Ranked from decks people actually built.</h2>
        <p className="mt-3 max-w-prose leading-relaxed text-muted-foreground">
          Suggestions come from how often a card turns up in real decks for your commander, and from what each
          card does on the table, so a swap holds the deck’s shape instead of just matching its price. When we
          don’t have enough decks for a commander, the page says so.
        </p>
      </section>
    </div>
  );
}
