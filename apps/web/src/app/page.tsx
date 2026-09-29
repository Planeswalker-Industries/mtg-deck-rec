import Link from "next/link";
import { Suspense } from "react";
import { ClipboardPaste, Library } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ArtBackdrop } from "@/components/ui/art-backdrop";
import { Panel } from "@/components/ui/panel";
import { SectionHeading } from "@/components/ui/section-heading";
import { FeaturedCommanders } from "@/components/home/featured-commanders";
import { HeroFan } from "@/components/home/hero-fan";
import { HowItWorks } from "@/components/home/how-it-works";
import { getFeaturedCommanders } from "@/lib/server/recs-cache";
import { CLOSING_VISTA, HERO_VISTA, type Vista } from "@/lib/landing-art";

/** The closing panel is a third of the 72rem column on desktop and full width below it. */
const CLOSING_ART_SIZES = "(min-width: 1024px) 384px, 100vw";

function ArtCredit({ vista, className }: { vista: Vista; className?: string }) {
  return (
    <p className={className ?? "text-xs text-muted-foreground"}>
      Art from{" "}
      <Link href={`/card/${vista.cardSlug}`} className="underline underline-offset-2 hover:text-foreground">
        {vista.cardName}
      </Link>{" "}
      by {vista.artist}
    </p>
  );
}

async function FeaturedCommandersSection() {
  const commanders = await getFeaturedCommanders();
  return (
    <Panel as="section" role="region" aria-label="Popular Commanders" className="overflow-hidden lg:col-span-2">
      <SectionHeading>Popular Commanders</SectionHeading>
      <div className="mt-5">
        <FeaturedCommanders commanders={commanders} />
      </div>
    </Panel>
  );
}

/** The closing line, one short sentence to a line, over the art. Credits its art only when it isn't the hero's. */
function StrongestDecksPanel() {
  return (
    <section className="relative isolate flex min-h-[22rem] flex-col justify-end overflow-hidden rounded-md border border-seam p-5 sm:p-6">
      <ArtBackdrop src={CLOSING_VISTA.src} wash="bottom" sizes={CLOSING_ART_SIZES} position="object-[70%_center]" />
      <h2 className="font-heading text-[1.75rem] leading-[1.15] font-semibold">
        <span className="block">The strongest decks.</span> <span className="block">Your own cards.</span>{" "}
        <span className="block text-primary">No singles necessary.</span>
      </h2>
      <Link
        href="/deck"
        className={buttonVariants({
          size: "lg",
          className: "lit mt-5 h-12 w-fit gap-2 px-6 text-base font-bold",
        })}
      >
        Get started
      </Link>
      {CLOSING_VISTA.src !== HERO_VISTA.src && <ArtCredit vista={CLOSING_VISTA} className="mt-4 text-xs text-muted-foreground" />}
    </section>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-10 pb-3 md:gap-14">
      {/*
       * Full-bleed: the art has to reach the window edges, not the content column. The negative margin
       * needs `overflow-x: clip` on html and body (globals.css) so 100vw can't add a horizontal scrollbar.
       * The section is `relative` and the inner container is not, so the art layer sizes against the bleed.
       */}
      <section className="relative isolate mx-[calc(50%-50vw)] -mt-4 w-[100vw] overflow-hidden border-b border-seam">
        <ArtBackdrop src={HERO_VISTA.src} wash="left" sizes="100vw" priority />

        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 pt-8 pb-10 md:min-h-[30rem] md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:items-center md:gap-4 md:py-14 lg:min-h-[36rem] lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          {/* Cards come first on a phone: they say what this is faster than any sentence. */}
          <HeroFan />

          <div className="relative z-20 max-w-2xl">
            <h1 className="font-heading text-[2.25rem] leading-[1.04] font-semibold tracking-[-0.02em] sm:text-[2.75rem] lg:text-[3.5rem]">
              Supercharge your Commander deck.
              <span className="mt-1 block text-primary/85">Using the cards you already own</span>
            </h1>
            <p className="mt-5 max-w-[34rem] text-lg leading-relaxed text-foreground/75">
              Import your collection, improve your deck, or swap your cards into the most popular Commander decks and
              skip the expensive singles.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
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
                href="/collection/import"
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: "h-12 gap-2 bg-background/40 px-6 text-base font-bold",
                })}
              >
                <Library aria-hidden className="size-5" />
                Import your collection
              </Link>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">No account necessary</p>
          </div>
        </div>

        <div className="mx-auto w-full max-w-6xl px-4 pb-3 md:absolute md:inset-x-0 md:bottom-0 md:flex md:justify-end">
          <ArtCredit vista={HERO_VISTA} />
        </div>
      </section>

      <HowItWorks />

      <div className="grid gap-5 lg:grid-cols-3 lg:items-stretch">
        <Suspense fallback={<div className="lg:col-span-2" />}>
          <FeaturedCommandersSection />
        </Suspense>
        <StrongestDecksPanel />
      </div>
    </div>
  );
}
