import type { ReactNode } from "react";
import Image from "next/image";
import type { CardSummary } from "@mtg/core/contract";
import { cn } from "cn";

/** The art strip spans the whole plate on phones and the right three quarters from sm up. */
const ART_SIZES = "(min-width: 640px) 75vw, 100vw";

/**
 * The commanders' art behind a header, fading in from the right like a card plate's; partners share the strip.
 * The left stays clear for the name, and the art is dimmed so copy over it stays legible. Purely decorative, so
 * hidden from assistive tech.
 */
export function CommanderArt({
  commanders,
  sizes = ART_SIZES,
  priority = false,
  className,
}: {
  commanders: readonly CardSummary[];
  sizes?: string;
  /** Eager-load the art: for page headers in the first viewport. */
  priority?: boolean;
  className?: string;
}) {
  const arts = commanders.flatMap((c) => (c.images?.front.artCrop ? [c.images.front.artCrop] : []));
  if (arts.length === 0) return null;
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 right-0 flex w-full [mask-image:linear-gradient(to_right,transparent,black_60%)] sm:w-3/4",
        className,
      )}
    >
      {arts.map((src) => (
        <span key={src} className="relative flex-1">
          <Image src={src} alt="" fill unoptimized priority={priority} sizes={sizes} className="object-cover object-[center_30%] brightness-75" />
        </span>
      ))}
    </div>
  );
}

/**
 * A panel headed by the commanders' art: BuildView, the deck page and the edit page open on it.
 * No hooks, so a server component can render it. The children sit over the art; keep their copy on the left.
 */
export function CommanderPlate({
  commanders,
  as: Tag = "header",
  priority = false,
  className,
  children,
}: {
  commanders: readonly CardSummary[];
  as?: "header" | "div";
  /** Eager-load the art (page headers). */
  priority?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={cn("relative isolate overflow-hidden rounded-panel border border-seam bg-sleeve", className)}>
      <CommanderArt commanders={commanders} priority={priority} />
      <div className="relative">{children}</div>
    </Tag>
  );
}
