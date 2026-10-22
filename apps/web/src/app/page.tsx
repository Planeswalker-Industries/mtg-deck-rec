import Link from "next/link";
import { Suspense } from "react";
import { buttonVariants } from "@/components/ui/button";
import { ArtBackdrop } from "@/components/ui/art-backdrop";
import { ArtCredit } from "@/components/ui/art-credit";
import { Band } from "@/components/ui/band";
import { SectionHeading } from "@/components/ui/section-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { FEATURED_DECKS } from "@/lib/featured-decks";
import { FeaturedCommanders } from "@/components/home/featured-commanders";
import { HeroFan } from "@/components/home/hero-fan";
import { HowItWorks } from "@/components/home/how-it-works";
import { Situations } from "@/components/home/situations";
import { getFeaturedCommanders } from "@/lib/server/recs-cache";
import { CLOSING_VISTA, HERO_VISTA } from "@/lib/landing-art";

/** The closing art runs from its column to the window edge on desktop, and full width below it. */
const CLOSING_ART_SIZES = "(min-width: 1024px) 50vw, 100vw";

/**
 * How far the closing art reaches past its cell on the right: the column's 1rem gutter, plus the margin beside the
 * page column (`--page-column`, globals.css) once the window is wider than it. So the art always meets the window edge.
 */
const CLOSING_ART_RIGHT = "calc(min(0px, (var(--page-column) - 100vw) / 2) - 1rem)";

async function FeaturedCommandersSection() {
  const commanders = await getFeaturedCommanders();
  return (
    <section aria-labelledby="popular-decks" className="py-8 md:py-10 lg:col-span-2 lg:pr-8">
      <FeaturedCommanders
        commanders={commanders}
        intro={
          <SectionHeading id="popular-decks" eyebrow="Featured" nowrap>
            Popular Decks
          </SectionHeading>
        }
      />
    </section>
  );
}

/** Popular Decks while it loads: the heading, the ring and one tile per featured deck, in the same grid. */
function FeaturedCommandersSkeleton() {
  return (
    <section aria-busy="true" aria-label="Popular Decks" className="py-8 md:py-10 lg:col-span-2 lg:pr-8">
      <SectionHeading eyebrow="Featured" nowrap>
        Popular Decks
      </SectionHeading>
      <div className="mt-6 grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-4 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-8">
        <Skeleton className="aspect-square rounded-full" />
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3 md:gap-3">
          {FEATURED_DECKS.map((deck) => (
            <Skeleton key={deck.slug} className="h-16 rounded-lg md:aspect-[4/5] md:h-auto" />
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The closing line, one short sentence to a line, over art that runs to the window edge. The seam on its left divides
 * it from Popular Decks. Credits its art only when it isn't the hero's.
 */
function StrongestDecks() {
  return (
    <section className="relative isolate border-t border-seam py-8 md:py-10 lg:border-t-0 lg:border-l lg:pl-8">
      <div aria-hidden className="absolute inset-y-0 -left-4 lg:left-0" style={{ right: CLOSING_ART_RIGHT }}>
        <ArtBackdrop src={CLOSING_VISTA.src} wash="left" sizes={CLOSING_ART_SIZES} position={CLOSING_VISTA.position} />
      </div>
      <h2 className="font-heading text-2xl font-semibold tracking-tight">
        <span className="block">You already bought the cards.</span>{" "}
        <span className="block font-drama font-normal tracking-normal italic text-foreground/85">
          Let&apos;s build something awesome.
        </span>
      </h2>
      <Link
        href="/deck"
        className={buttonVariants({
          size: "lg",
          className: "lit mt-6 h-12 w-fit gap-2 px-6 text-base font-semibold",
        })}
      >
        Get started
      </Link>
      {CLOSING_VISTA.src !== HERO_VISTA.src && (
        <ArtCredit vista={CLOSING_VISTA} className="mt-4 text-xs text-muted-foreground" />
      )}
    </section>
  );
}

export default function Home() {
  return (
    // Bands meet rule to rule, and the last one meets the footer's rule: -mb-10 cancels the layout's bottom padding.
    <div className="-mb-10 flex flex-col">
      {/*
       * Full-bleed: the art has to reach the window edges, not the content column. The negative margin
       * needs `overflow-x: clip` on html and body (globals.css) so 100vw can't add a horizontal scrollbar.
       * The section is `relative` and the inner container is not, so the art layer sizes against the bleed.
       */}
      <section className="relative isolate mx-[calc(50%-50vw)] -mt-4 w-[100vw] overflow-hidden border-b border-seam">
        <ArtBackdrop src={HERO_VISTA.src} wash="left" sizes="100vw" position={HERO_VISTA.position} priority />

        {/* The fan's column stretches, so its credit sits at the hero's foot; the headline centres against the fan. */}
        <div className="page-column grid gap-6 pt-4 pb-8 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:gap-4 md:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
          {/* Cards come first on a phone: they say what this is faster than any sentence. */}
          <div className="order-first flex flex-col md:order-last">
            <div className="flex flex-1 items-center justify-center">
              <HeroFan />
            </div>
            {/* Clear of the passed card, which hangs below the fan's box. */}
            <ArtCredit vista={HERO_VISTA} className="hidden pt-10 text-right text-xs leading-5 text-muted-foreground md:block" />
          </div>

          <div className="relative z-20 max-w-2xl md:self-center">
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl xl:text-4xl">
              Build better decks.
              {/* The buddy's voice: the page's one italic headline phrase. */}
              <span className="mt-1 block font-drama font-normal tracking-normal text-balance italic text-foreground/85">
                Spend less on singles.
              </span>
            </h1>
            {/* Phones: the credit shares this line; from md up it sits under the fan, level with it. */}
            <div className="mt-4 flex items-end justify-between gap-3">
              <p className="shrink-0 text-sm leading-5 text-muted-foreground">No account necessary</p>
              <ArtCredit vista={HERO_VISTA} className="text-right text-xs leading-5 text-muted-foreground md:hidden" />
            </div>
          </div>
        </div>
      </section>

      <Situations />

      <HowItWorks />

      {/* The last band has no rule of its own: the footer's top rule closes it. */}
      <Band className="border-b-0" inner="grid lg:grid-cols-3">
        <Suspense fallback={<FeaturedCommandersSkeleton />}>
          <FeaturedCommandersSection />
        </Suspense>
        <StrongestDecks />
      </Band>
    </div>
  );
}
