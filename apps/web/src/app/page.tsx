import Link from "next/link";
import type { Route } from "next";
import { Suspense } from "react";
import { ArrowRight, Compass, ScrollText } from "lucide-react";
import { cn } from "cn";
import { Skeleton } from "@/components/ui/skeleton";
import { HeroPile } from "@/components/home/hero-pile";
import { CommandersAndDecks } from "@/components/home/commanders-and-decks";
import { HowItWorks } from "@/components/home/how-it-works";
import { SheetSection } from "@/components/ui/sheet-section";
import { getHomeShowcase } from "@/lib/server/recs-cache";
import { BUILD_DECK_HREF, HOME_SHOWCASE_SIZE } from "@/lib/constants";

/*
 * The homepage (2026-11-20): sheets of cream paper on a walnut table, in dark ink, espresso and muted brass.
 */

/** The two ways in. The commander path is the wax seal; the decklist path its brass-edged partner. */
const STARTS: { label: string; sub: string; href: Route; icon: typeof Compass; seal: boolean }[] = [
  { label: "Choose a Commander", sub: "Build a deck around one", href: BUILD_DECK_HREF as Route, icon: Compass, seal: true },
  { label: "Improve a Decklist", sub: "Paste one and tune it", href: "/deck", icon: ScrollText, seal: false },
];

/** The two ways in, as a pair of buttons: in the hero and again under the closing line. */
function StartButtons({ className }: { className?: string }) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-2", className)}>
      {STARTS.map((start) => (
        <li key={start.label}>
          <Link
            href={start.href}
            className={cn(
              "group flex min-h-14 items-center gap-3 rounded-md px-4 py-2.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]",
              start.seal ? "seal" : "seal-outline",
            )}
          >
            <start.icon aria-hidden className="size-6 shrink-0" strokeWidth={1.5} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="font-heading text-lg font-semibold">{start.label}</span>
              <span className={cn("text-xs", start.seal ? "text-(--paper-recessed)" : "text-[var(--ink-soft)]")}>{start.sub}</span>
            </span>
            <ArrowRight aria-hidden className="size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Hero() {
  return (
    <SheetSection aria-labelledby="hero" className="overflow-hidden px-5 pt-6 pb-7 sm:px-8 md:py-10">
      {/* Faded sea chart behind the cards. */}
      <div
        aria-hidden
        className="chart-ink absolute inset-y-0 right-0 w-full bg-[length:26rem] bg-[position:right_-6rem_top_-4rem] md:w-1/2 md:bg-[length:36rem] md:bg-center"
      />

      {/* Not `relative`: on a phone the pile's table covers the whole sheet (its nearest positioned ancestor), and the
          cards fall behind the headline. A paper wash between them keeps the copy legible. */}
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] md:items-center md:gap-6">
        {/* Cards come first on a phone: they say what this is faster than any sentence. */}
        <div className="order-first md:order-last">
          <HeroPile />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(to_top,var(--paper)_45%,color-mix(in_srgb,var(--paper)_75%,transparent)_62%,transparent_85%)] md:hidden"
        />

        <div className="relative z-20">
          <h1 id="hero" className="font-heading text-3xl font-semibold tracking-tight xl:text-4xl">
            Build better decks.
            <span className="block text-[var(--primary)]">Spend less.</span>
          </h1>
          <p className="mt-3 max-w-md text-base text-[var(--ink-soft)] md:text-lg">
            Build around a commander, improve an existing list, and find swaps from cards already owned.
          </p>

          <StartButtons className="mt-6" />
        </div>
      </div>
    </SheetSection>
  );
}

/** Commanders & Decks: the Highlight, Popular Commanders and Latest Decks. */
async function CommandersAndDecksSection() {
  const { popular, latest } = await getHomeShowcase();
  return <CommandersAndDecks popular={popular} latest={latest} />;
}

/** Commanders & Decks while it loads: the same three columns, the Highlight's plate and the rows. */
function CommandersAndDecksSkeleton() {
  const column = (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-8 w-2/3" />
      {Array.from({ length: HOME_SHOWCASE_SIZE }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </div>
  );
  return (
    <div aria-busy="true" className="grid gap-8 lg:grid-cols-[4fr_3fr_3fr] lg:gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="aspect-[16/9]" />
        <Skeleton className="h-11" />
      </div>
      {column}
      {column}
    </div>
  );
}

/** The closing line on its own small sheet, with both ways in under it. */
function Closing() {
  return (
    <SheetSection className="mx-auto w-full max-w-2xl px-6 py-8 text-center">
      <h2 className="font-heading text-xl font-semibold sm:text-2xl">You already bought the cards.</h2>
      <p className="mt-1 font-drama text-xl text-[var(--ink-soft)] italic">Let&apos;s build something awesome.</p>
      <StartButtons className="mt-6 text-left" />
    </SheetSection>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col gap-5 pt-2 md:gap-8 md:pt-4">
      <Hero />
      <HowItWorks />
      <SheetSection aria-label="Commanders & Decks" className="px-5 py-8 sm:px-8 md:py-10">
        <Suspense fallback={<CommandersAndDecksSkeleton />}>
          <CommandersAndDecksSection />
        </Suspense>
      </SheetSection>
      <Closing />
    </div>
  );
}
