import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { ClipboardPaste, Library, Plus, Repeat2, Scissors } from "lucide-react";
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
const FAN_SIZES = "(min-width: 768px) 220px, 42vw";
/** The card at the centre of the fan, so the credit names what people are actually looking at. */
const HERO_SLUG = "chulane-teller-of-tales";

/** The three jobs, in the order the deck tool does them. Colors stay off the mana wheel. */
const jobs = [
  { name: "Cut", summary: "Weak links", Icon: Scissors, tone: "text-cut", ring: "border-cut/40 bg-cut/10" },
  { name: "Add", summary: "Missing pieces", Icon: Plus, tone: "text-add", ring: "border-add/40 bg-add/10" },
  {
    name: "Replace",
    summary: "Another way to do the job",
    Icon: Repeat2,
    tone: "text-replace",
    ring: "border-replace/40 bg-replace/10",
  },
];

async function HeroArt() {
  const hero = await getHeroArt(HERO_SLUG);
  if (!hero) return null;
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <Image src={hero.art} alt="" fill unoptimized priority className="object-cover object-center" />
        {/* The headline sits on the left, so the wash is heaviest there and thins out under the cards. */}
        <div className="absolute inset-0 bg-background/30" />
        <div className="absolute inset-0 bg-gradient-to-r from-background via-background/70 to-background/40" />
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/45" />
      </div>
      <p className="relative mt-10 text-xs text-muted-foreground">
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
    <div className="flex flex-col gap-8 pb-6 md:gap-12">
      {/*
       * Full-bleed: the art has to reach the window edges, not the content column. The negative margin
       * needs `overflow-x: clip` on body (globals.css) so 50vw can't add a horizontal scrollbar.
       */}
      <section className="relative mx-[calc(50%-50vw)] w-[100vw] overflow-x-clip">
        <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-8 md:pt-14 md:pb-10">
          <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-8">
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
                    <CardImage card={pocket.card} alt="" sizes={FAN_SIZES} eager className="shadow-[0_18px_40px_-16px_rgb(0_0_0/0.9)]" />
                  </div>
                ))}
              </div>
            </div>

            <div className="max-w-3xl">
              <h1 className="font-heading text-[2.15rem] leading-[1.08] font-semibold tracking-[-0.015em] sm:text-[2.5rem] lg:text-[2.85rem]">
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

          <ul aria-label="What the deck tool shows you" className="mt-10 grid grid-cols-3 gap-3 sm:flex sm:flex-wrap sm:gap-x-10 sm:gap-y-4">
            {jobs.map(({ name, summary, Icon, tone, ring }) => (
              <li key={name} className="flex flex-col items-center gap-2 text-center sm:flex-row sm:gap-3 sm:text-left">
                <span className={`flex size-11 shrink-0 items-center justify-center rounded-full border ${ring} ${tone}`}>
                  <Icon aria-hidden className="size-5" strokeWidth={2.5} />
                </span>
                <span className="min-w-0">
                  <span className="block font-heading text-lg leading-none font-semibold">{name}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{summary}</span>
                </span>
              </li>
            ))}
          </ul>

          {/* Null while it loads and null if it fails, so the landing page never waits on the database. */}
          <Suspense fallback={null}>
            <HeroArt />
          </Suspense>
        </div>
      </section>

      <section className="rounded-xl border border-seam bg-sleeve/60 p-5 sm:p-7">
        <h2 className="font-heading text-2xl leading-tight font-semibold">Ranked from decks people actually built.</h2>
        <p className="mt-3 max-w-prose leading-relaxed text-muted-foreground">
          Cuts are the cards costing more than they give you, sitting outside your colors, or pushing the deck past its
          bracket. Additions are what decks with your commander play that yours doesn&rsquo;t. Replacements are cards that
          do the same job, with the price difference shown before you commit.
        </p>
        <p className="mt-3 max-w-prose leading-relaxed text-muted-foreground">
          All of it comes from how often a card turns up in real decks for your commander, and from what each card does on
          the table, so a swap holds the deck&rsquo;s shape instead of just matching its price. When we don&rsquo;t have
          enough decks for a commander, the page says so.
        </p>
      </section>
    </div>
  );
}
