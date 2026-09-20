import Image from "next/image";
import Link from "next/link";
import { Fragment, Suspense } from "react";
import { ArrowRight, ClipboardPaste, Library, Plus, Repeat2, Scissors } from "lucide-react";
import { mockCards } from "@mtg/core/mocks";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { buttonVariants } from "@/components/ui/button";
import { FeaturedCommanders } from "@/components/home/featured-commanders";
import { getFeaturedCommanders, getHeroArt } from "@/lib/server/recs-cache";

function sampleCard(name: string): CardSummary {
  const card = mockCards.find((c) => c.name === name);
  if (!card) throw new Error(`Sample card missing from fixtures: ${name}`);
  return card;
}

/** A hand fanned out on the table, commander in the middle and lit from above. */
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
const FAN_SIZES = "(min-width: 768px) 176px, 42vw";

/**
 * Lands, in preference order: their art is painted as scenery, which is what a wide banner needs.
 * A creature portrait crops to a face and reads as a mistake at this size.
 */
const HERO_SLUGS = ["cavern-of-souls", "path-of-ancestry", "boseiju-who-endures", "castle-locthwain", "command-tower"] as const;

/** The three jobs, in the order the deck tool does them. Colors stay off the mana wheel. */
const jobs = [
  { name: "Cut", summary: "Weak links", Icon: Scissors, tone: "text-cut", ring: "border-cut/50 bg-cut/15" },
  { name: "Add", summary: "Missing pieces", Icon: Plus, tone: "text-add", ring: "border-add/50 bg-add/15" },
  { name: "Replace", summary: "Same job", Icon: Repeat2, tone: "text-replace", ring: "border-replace/50 bg-replace/15" },
];

async function HeroArtLayer() {
  const hero = await getHeroArt(HERO_SLUGS);
  if (!hero) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <Image src={hero.art} alt="" fill unoptimized priority className="object-cover object-center" />
      {/* The headline sits on the left, so the wash is heaviest there and thins out under the cards. */}
      <div className="absolute inset-0 bg-background/25" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/65 to-background/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-background/40" />
    </div>
  );
}

async function HeroCredit() {
  const hero = await getHeroArt(HERO_SLUGS);
  if (!hero) return null;
  return (
    <p className="text-xs text-muted-foreground">
      Art from{" "}
      <Link href={`/card/${hero.slug}`} className="underline underline-offset-2 hover:text-foreground">
        {hero.name}
      </Link>{" "}
      by {hero.artist}
    </p>
  );
}

async function FeaturedCommandersSection() {
  const commanders = await getFeaturedCommanders();
  return (
    <section
      role="region"
      aria-label="Popular Commanders"
      className="rounded-xl border border-seam bg-background p-5 sm:p-7"
    >
      <h2 className="flex items-center gap-3 text-xs font-bold tracking-[0.25em] text-primary uppercase">
        <span aria-hidden className="h-px w-6 bg-primary/60" />
        Popular Commanders
      </h2>
      <div className="mt-5">
        <FeaturedCommanders commanders={commanders} />
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-10 pb-6 md:gap-14">
      {/*
       * Full-bleed: the art has to reach the window edges, not the content column. The negative margin
       * needs `overflow-x: clip` on html and body (globals.css) so 100vw can't add a horizontal scrollbar.
       * The section is `relative` and the inner container is not, so the art layer sizes against the bleed.
       */}
      <section className="relative isolate mx-[calc(50%-50vw)] w-[100vw] overflow-hidden md:min-h-[21rem] lg:min-h-[23rem]">
        {/* Null while it loads and null if it fails, so the landing page never waits on the database. */}
        <Suspense fallback={null}>
          <HeroArtLayer />
        </Suspense>

        <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-6 md:pt-12 md:pb-8">
          <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-8">
            {/* Cards come first on a phone: they say what this is faster than any sentence. */}
            <div aria-hidden className="order-first md:order-last md:origin-top md:scale-[1.28]">
              <div className="relative mx-auto h-[14rem] w-[9.5rem] sm:h-[16rem] sm:w-[9rem] md:h-[14rem] md:w-[10rem] lg:h-[15rem] lg:w-[10.75rem]">
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
                    <CardImage card={pocket.card} alt="" sizes={FAN_SIZES} eager className="shadow-[0_18px_40px_-16px_rgb(0_0_0/0.9)]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="relative z-20 max-w-3xl">
              <h1 className="font-heading text-[2rem] leading-[1.08] font-semibold tracking-[-0.015em] sm:text-[2.25rem] lg:text-[2.5rem]">
                Tune your Commander deck.
                <span className="block text-primary/85">Using the cards you actually own.</span>
              </h1>
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
                Find weak links. Discover additions. Compare replacements.
              </p>

              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href="/deck" className={buttonVariants({ size: "lg", className: "lit h-12 gap-2 px-6 text-base font-bold" })}>
                  <ClipboardPaste aria-hidden className="size-5" />
                  Paste a decklist
                </Link>
                <Link
                  href="/collection"
                  className={buttonVariants({ variant: "outline", size: "lg", className: "h-12 gap-2 px-6 text-base font-bold" })}
                >
                  <Library aria-hidden className="size-5" />
                  Browse your collection
                </Link>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">No account needed.</p>
            </div>
          </div>
        </div>

        {/*
         * Layer 1 of 2 over the content: a shadow that darkens the foot of the banner so the jobs stay
         * readable over whatever art is behind them. Its own layer, not the jobs' background, so it
         * washes over the cards and the lower headline too.
         */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-48 bg-gradient-to-t from-black via-black/70 to-transparent md:h-3/5"
        />

        {/* Layer 2: the three jobs, in front of the cards and justified to the end of the frame. */}
        <div className="relative z-20 mt-6 pb-6 md:absolute md:inset-x-0 md:bottom-0 md:mt-0 md:pb-5">
          <div className="mx-auto flex w-full max-w-6xl px-4">
            <ul
              aria-label="What the deck tool shows you"
              className="grid grid-cols-3 gap-2.5 sm:flex sm:flex-wrap sm:justify-end sm:gap-x-6 sm:gap-y-4 md:ml-auto md:max-w-[25rem]"
            >
              {jobs.map(({ name, summary, Icon, tone, ring }) => (
                <li key={name} className="flex flex-col items-center gap-2 text-center sm:flex-row sm:gap-3 sm:text-left">
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full border ${ring} ${tone}`}>
                    <Icon aria-hidden className="size-4" strokeWidth={2.5} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-heading text-base leading-none font-semibold">{name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{summary}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="-mt-6 px-4 md:-mt-10">
        <Suspense fallback={null}>
          <HeroCredit />
        </Suspense>
      </div>

      <Suspense fallback={null}>
        <div className="px-4">
          <FeaturedCommandersSection />
        </div>
      </Suspense>

      {/* Three steps */}
      <section className="px-4">
        <div role="list" className="flex flex-col gap-6 sm:flex-row sm:items-stretch">
          {[
            { step: 1, title: "Add your decklist", desc: "Paste, or import from Archidekt, ManaBox, Moxfield or TCGplayer." },
            { step: 2, title: "Import your collection", desc: "A CSV or text export from the same apps. Optional." },
            { step: 3, title: "Find the perfect swaps", desc: "Cuts, additions and substitutes, with the price difference before you commit." },
          ].map(({ step, title, desc }, i) => (
            <Fragment key={step}>
              <div role="listitem" className="flex flex-1 gap-4 rounded-xl border border-seam bg-sleeve/60 p-5">
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary"
                >
                  {step}
                </span>
                <div>
                  <h3 className="font-heading text-base font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
              </div>
              {i < 2 && (
                <div aria-hidden className="hidden shrink-0 items-center justify-center self-center text-muted-foreground sm:flex">
                  <ArrowRight className="size-5" />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </section>

      {/* Closing CTA */}
      <section className="rounded-xl border border-seam bg-sleeve/60 p-5 sm:p-7">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-heading text-xl font-semibold">Your collection. Your deck. Optimized.</h2>
            <p className="mt-1 text-sm text-muted-foreground">No account needed.</p>
          </div>
          <Link href="/deck" className={buttonVariants({ size: "lg", className: "lit h-12 gap-2 px-6 text-base font-bold" })}>
            Get started
          </Link>
        </div>
      </section>
    </div>
  );
}
