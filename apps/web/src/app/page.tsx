import Image from "next/image";
import Link from "next/link";
import { Fragment, Suspense } from "react";
import { ArrowRight, ClipboardPaste, Library } from "lucide-react";
import { mockCards } from "@mtg/core/mocks";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { buttonVariants } from "@/components/ui/button";
import { FeaturedCommanders } from "@/components/home/featured-commanders";
import { getFeaturedCommanders } from "@/lib/server/recs-cache";

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
  {
    card: sampleCard("Cultivate"),
    rotate: -22,
    x: "-64%",
    y: "10%",
    scale: 0.86,
    wide: true,
  },
  {
    card: sampleCard("Rhystic Study"),
    rotate: -11,
    x: "-33%",
    y: "3%",
    scale: 0.93,
  },
  {
    card: sampleCard("Chulane, Teller of Tales"),
    rotate: 0,
    x: "0%",
    y: "-4%",
    scale: 1,
  },
  {
    card: sampleCard("Counterspell"),
    rotate: 11,
    x: "33%",
    y: "3%",
    scale: 0.93,
  },
  {
    card: sampleCard("Birds of Paradise"),
    rotate: 22,
    x: "64%",
    y: "10%",
    scale: 0.86,
    wide: true,
  },
];
const FAN_SIZES = "(min-width: 768px) 176px, 42vw";

/**
 * The landing art: a local high-res crop, so the page needs no catalog read to render. It is the
 * backdrop of both the hero and the closing CTA, which is why it lives in one constant.
 */
const HERO_ART = "/cavern_of_souls_high_res.jpg";

function HeroArtLayer() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <Image
        src={HERO_ART}
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      {/* The headline sits on the left, so the wash is heaviest there and thins out under the cards. */}
      <div className="absolute inset-0 bg-background/25" />
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/65 to-background/25" />
      <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-transparent to-background/40" />
    </div>
  );
}

function HeroCredit() {
  return (
    <p className="text-xs text-muted-foreground">
      Art from{" "}
      <Link
        href="/card/cavern-of-souls"
        className="underline underline-offset-2 hover:text-foreground"
      >
        Cavern of Souls
      </Link>{" "}
      by Alayna Danner
    </p>
  );
}

async function FeaturedCommandersSection() {
  const commanders = await getFeaturedCommanders();
  return (
    <section
      role="region"
      aria-label="Popular Commanders"
      className="overflow-hidden rounded-xl border border-seam bg-background p-5 sm:p-7"
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
    <div className="flex flex-col gap-5 pb-3 md:gap-7">
      {/*
       * Full-bleed: the art has to reach the window edges, not the content column. The negative margin
       * needs `overflow-x: clip` on html and body (globals.css) so 100vw can't add a horizontal scrollbar.
       * The section is `relative` and the inner container is not, so the art layer sizes against the bleed.
       */}
      <section className="relative isolate mx-[calc(50%-50vw)] -mt-2 w-[100vw] overflow-hidden md:min-h-[21rem] lg:min-h-[23rem]">
        <HeroArtLayer />

        <div className="mx-auto w-full max-w-6xl px-4 pt-2 pb-1.5 md:pt-3 md:pb-2">
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-4">
            {/* Cards come first on a phone: they say what this is faster than any sentence. */}
            <div
              aria-hidden
              className="order-first md:order-last md:origin-top md:scale-[1.28]"
            >
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

            <div className="relative z-20 max-w-3xl">
              <h1 className="font-heading text-[2rem] leading-[1.08] font-semibold tracking-[-0.015em] sm:text-[2.25rem] lg:text-[2.5rem]">
                Supercharge your Commander deck.
                <span className="block text-primary/85">
                  Using the cards you already own
                </span>
              </h1>
              <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
                Import your collection, improve your deck, or swap your cards
                into the most popular Commander decks and skip the expensive
                singles.
              </p>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/deck"
                  className={buttonVariants({
                    size: "lg",
                    className: "lit h-12 gap-2 px-6 text-base font-bold",
                  })}
                >
                  <ClipboardPaste aria-hidden className="size-5" />
                  Paste a decklist
                </Link>
                <Link
                  href="/collection"
                  className={buttonVariants({
                    variant: "outline",
                    size: "lg",
                    className: "h-12 gap-2 px-6 text-base font-bold",
                  })}
                >
                  <Library aria-hidden className="size-5" />
                  Import your collection
                </Link>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                No account necessary
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="-mt-3 px-4 md:-mt-5">
        <HeroCredit />
      </div>

      <Suspense fallback={null}>
        <div className="px-4">
          <FeaturedCommandersSection />
        </div>
      </Suspense>

      {/* Three steps */}
      <section className="px-4">
        <div
          role="list"
          className="flex flex-col gap-3 sm:flex-row sm:items-stretch"
        >
          {[
            {
              step: 1,
              title: "Import your collection",
              desc: "Via text, CSV, or from the most popular web apps.",
            },
            {
              step: 2,
              title: "Add your decklist",
              desc: "Either your own or from your favorite site.",
            },
            {
              step: 3,
              title: "Cut/Add/Replace",
              desc: "Tailored recommendations to swap out expensive cards or improve your existing deck with the cards you already own.",
            },
          ].map(({ step, title, desc }, i) => (
            <Fragment key={step}>
              <div
                role="listitem"
                className="flex flex-1 gap-4 rounded-xl border border-seam bg-sleeve/60 p-5"
              >
                <span
                  aria-hidden
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary"
                >
                  {step}
                </span>
                <div>
                  <h3 className="font-heading text-base font-semibold">
                    {title}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
                </div>
              </div>
              {i < 2 && (
                <div
                  aria-hidden
                  className="hidden shrink-0 items-center justify-center self-center text-muted-foreground sm:flex"
                >
                  <ArrowRight className="size-5" />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      </section>

      {/* Closing CTA. The same art as the hero, washed down so the copy and button stay readable. */}
      <section className="relative isolate overflow-hidden rounded-xl border border-seam">
        <Image
          src={HERO_ART}
          alt=""
          fill
          sizes="(min-width: 1152px) 1152px, 100vw"
          className="-z-10 object-cover object-center"
        />
        <div aria-hidden className="absolute inset-0 -z-10 bg-background/70" />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/70 to-background/25"
        />
        <div className="relative z-10 flex flex-col items-start gap-2 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
          <h2 className="font-heading text-xl font-semibold">
            The strongest decks. Your own cards. No singles necessary.
          </h2>
          <Link
            href="/deck"
            className={buttonVariants({
              size: "lg",
              className: "lit h-12 gap-2 px-6 text-base font-bold",
            })}
          >
            Get started
          </Link>
        </div>
      </section>
    </div>
  );
}
