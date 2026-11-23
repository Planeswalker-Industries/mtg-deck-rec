import type { ReactNode } from "react";
import { cn } from "cn";
import { ArtPlate } from "@/components/ui/art-plate";
import { TOOL_VISTA, type Vista } from "@/lib/landing-art";

/**
 * A page's opening screen: one sheet holding the heading with the buddy's line under it, what the screen does, and the
 * form (or the page's one job), all on paper. The land art is a framed plate (`ArtPlate`): a banner across the top of
 * the sheet on phones and tablets, a square beside the copy from `lg` (the vistas are 4:5 portraits whose foot carries
 * the scan's own copyright line, so neither crop reaches it). No copy sits on the art.
 * Used by the deck tool's opening screens (paste a list, pick a commander), the collection's, sign-in and rating.
 */
export function PageHero({
  id,
  heading,
  aside,
  intro,
  children,
  vista = TOOL_VISTA,
  slimArt = false,
}: {
  /** The heading's id, for the section's accessible name. */
  id: string;
  heading: string;
  /** The buddy's voice, one short line in `font-drama` under the heading. Omitted, the heading stands alone. */
  aside?: string;
  /** What the screen does, and any notes (a restored deck, the collection). */
  intro: ReactNode;
  /** The form, set on the paper under the intro. */
  children: ReactNode;
  /** The land art on the plate (`lib/landing-art.ts`). */
  vista?: Vista;
  /** A thinner banner on phones, for a screen whose form must fit above the fold (the build start, T102). */
  slimArt?: boolean;
}) {
  return (
    <section
      aria-labelledby={id}
      className="sheet grid gap-5 p-4 sm:p-6 md:gap-6 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:gap-8 lg:p-8"
    >
      <ArtPlate
        src={vista.src}
        credit={vista}
        position={vista.position}
        sizes="(min-width: 1024px) 40vw, 100vw"
        priority
        className={cn("aspect-[16/7] lg:order-last lg:aspect-square lg:self-start", slimArt && "max-sm:aspect-[16/4]")}
      />
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-4">
          <h1 id={id} className="font-heading text-2xl font-semibold tracking-tight sm:text-3xl">
            {heading}
            {aside && (
              <span className="mt-1 block font-drama font-normal tracking-normal text-balance text-muted-foreground italic max-sm:text-xl">
                {aside}
              </span>
            )}
          </h1>
          <div className="flex flex-col gap-3 text-muted-foreground">{intro}</div>
        </div>
        <div className="border-t border-seam pt-5">{children}</div>
      </div>
    </section>
  );
}
