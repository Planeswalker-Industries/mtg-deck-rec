import Link from "next/link";
import { cn } from "cn";
import { Suspense } from "react";
import { ClipboardPaste, Library } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { ArtBackdrop } from "@/components/ui/art-backdrop";
import { Band } from "@/components/ui/band";
import { SectionHeading } from "@/components/ui/section-heading";
import { Skeleton } from "@/components/ui/skeleton";
import { FEATURED_DECKS } from "@/lib/featured-decks";
import { FeaturedCommanders } from "@/components/home/featured-commanders";
import { HERO_PASS_ASIDE, HeroFan } from "@/components/home/hero-fan";
import { HowItWorks } from "@/components/home/how-it-works";
import { getFeaturedCommanders } from "@/lib/server/recs-cache";
import { CLOSING_VISTA, HERO_VISTA, type Vista } from "@/lib/landing-art";

/** Hero buttons: tall enough for a wrapped label on phones, the usual 48 px single line from sm up. */
const HERO_BUTTON =
  "h-auto min-h-12 gap-2 px-3 py-2 text-center text-sm leading-tight font-semibold whitespace-normal sm:h-12 sm:px-6 sm:text-base sm:whitespace-nowrap";

/** The closing art runs from its column to the window edge on desktop, and full width below it. */
const CLOSING_ART_SIZES = "(min-width: 1024px) 50vw, 100vw";

/**
 * How far the closing art reaches past its cell on the right: the column's 1rem gutter, plus the margin beside the
 * page column (`--page-column`, globals.css) once the window is wider than it. So the art always meets the window edge.
 */
const CLOSING_ART_RIGHT = "calc(min(0px, (var(--page-column) - 100vw) / 2) - 1rem)";

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
    <section aria-labelledby="popular-decks" className="py-12 md:py-16 lg:col-span-2 lg:pr-8">
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
    <section aria-busy="true" aria-label="Popular Decks" className="py-12 md:py-16 lg:col-span-2 lg:pr-8">
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
    <section className="relative isolate border-t border-seam py-12 md:py-16 lg:border-t-0 lg:border-l lg:pl-8">
      <div aria-hidden className="absolute inset-y-0 -left-4 lg:left-0" style={{ right: CLOSING_ART_RIGHT }}>
        <ArtBackdrop src={CLOSING_VISTA.src} wash="left" sizes={CLOSING_ART_SIZES} position={CLOSING_VISTA.position} />
      </div>
      <h2 className="font-heading text-2xl font-semibold tracking-tight">
        <span className="block">The strongest decks.</span> <span className="block">Your own cards.</span>{" "}
        <span className="block font-drama font-normal tracking-normal italic text-foreground/85">No singles necessary.</span>
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

        {/* The columns stretch, so the credit at the foot of the fan's column ends level with "No account necessary". */}
        <div className="page-column grid gap-6 pt-4 pb-12 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] md:gap-4 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
          {/* Cards come first on a phone: they say what this is faster than any sentence. */}
          <div className="order-first flex flex-col md:order-last">
            <div className="flex flex-1 items-center justify-center">
              <HeroFan />
            </div>
            {/* The buddy's aside for the card just passed onto the fan. */}
            <p className="mt-10 text-center font-drama text-lg text-balance text-foreground/85 italic md:mt-16">“{HERO_PASS_ASIDE}”</p>
            <ArtCredit vista={HERO_VISTA} className="hidden text-right text-xs leading-5 text-muted-foreground md:block" />
          </div>

          <div className="relative z-20 max-w-2xl">
            <h1 className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl xl:text-4xl">
              Supercharge your Commander deck.
              {/* The buddy's voice: the page's one italic headline phrase. */}
              <span className="mt-1 block font-drama font-normal tracking-normal text-balance italic text-foreground/85">
                Using the cards you already own.
              </span>
            </h1>
            <p className="mt-6 max-w-[34rem] text-lg text-foreground/80">
              Import your collection, improve your deck, or swap your cards into the most popular Commander decks and
              skip the expensive singles.
            </p>

            {/* Phones: two half-width buttons with shorter labels that may wrap; from sm up, the full labels in a row. */}
            <div className="mt-8 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap">
              <Link
                href="/deck"
                className={buttonVariants({
                  size: "lg",
                  className: cn(HERO_BUTTON, "lit"),
                })}
              >
                <ClipboardPaste aria-hidden className="size-5 shrink-0" />
                <span className="sm:hidden">Paste Decklist</span>
                <span className="hidden sm:inline">Paste a decklist</span>
              </Link>
              <Link
                href="/collection/import"
                className={buttonVariants({
                  variant: "outline",
                  size: "lg",
                  className: cn(HERO_BUTTON, "bg-background/40"),
                })}
              >
                <Library aria-hidden className="size-5 shrink-0" />
                <span className="sm:hidden">Import Collection</span>
                <span className="hidden sm:inline">Import your collection</span>
              </Link>
            </div>
            {/* Phones: the credit shares this line; from md up it sits under the fan, level with it. */}
            <div className="mt-3 flex items-end justify-between gap-3">
              <p className="shrink-0 text-sm leading-5 text-muted-foreground">No account necessary</p>
              <ArtCredit vista={HERO_VISTA} className="text-right text-xs leading-5 text-muted-foreground md:hidden" />
            </div>
          </div>
        </div>
      </section>

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
