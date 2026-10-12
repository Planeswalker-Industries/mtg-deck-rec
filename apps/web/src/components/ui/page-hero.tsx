import type { ReactNode } from "react";
import { ArtBackdrop } from "@/components/ui/art-backdrop";
import { ArtCredit } from "@/components/ui/art-credit";
import { TOOL_VISTA, type Vista } from "@/lib/landing-art";

/**
 * A page's opening screen, set like the landing page's hero: land art washed down behind the copy, the heading with the
 * buddy's line under it, and the form (or the page's one job) on an oak panel beside it (below it on phones). Used by
 * the deck tool's opening screens (paste a list, pick a commander), the collection's, sign-in and rating. Full-bleed
 * like the hero; as the page's first block, `-mt-4` meets the header's rule under the layout's top padding, and as its
 * last, `-mb-10` meets the footer's rule (cancelling the layout's bottom padding).
 * On wide screens it is at least 70% of the window tall, so a short form doesn't leave bare table under the art.
 */
export function PageHero({
  id,
  heading,
  aside,
  intro,
  children,
  vista = TOOL_VISTA,
}: {
  /** The heading's id, for the section's accessible name. */
  id: string;
  heading: string;
  /** The buddy's voice, one short line in `font-drama` under the heading. */
  aside: string;
  /** What the screen does, and any notes (a restored deck, the collection). */
  intro: ReactNode;
  /** The form, set on the panel. */
  children: ReactNode;
  /** The land art behind it (`lib/landing-art.ts`). */
  vista?: Vista;
}) {
  return (
    <section
      aria-labelledby={id}
      className="relative isolate mx-[calc(50%-50vw)] w-[100vw] overflow-hidden border-b border-seam first:-mt-4 last:-mb-10 last:border-b-0 lg:min-h-[70svh]"
    >
      <ArtBackdrop src={vista.src} wash="left" sizes="100vw" position={vista.position} priority />
      <div className="page-column grid items-start gap-6 pt-6 pb-8 md:py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-12 lg:py-16">
        <div className="flex max-w-xl flex-col gap-4">
          <h1 id={id} className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {heading}
            <span className="mt-1 block font-drama font-normal tracking-normal text-balance italic text-foreground/85 max-sm:text-xl">
              {aside}
            </span>
          </h1>
          <div className="flex flex-col gap-3 text-foreground/80">{intro}</div>
          <ArtCredit vista={vista} className="hidden text-xs text-muted-foreground lg:block" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="rounded-panel border border-seam bg-sleeve/90 p-4 backdrop-blur-sm sm:p-5">{children}</div>
          <ArtCredit vista={vista} className="text-xs text-muted-foreground lg:hidden" />
        </div>
      </div>
    </section>
  );
}
