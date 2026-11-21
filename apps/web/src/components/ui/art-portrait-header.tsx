import type { ReactNode } from "react";
import { cn } from "cn";
import { ArtPlate } from "@/components/ui/art-plate";
import type { ArtCreditInfo } from "@/components/ui/art-credit";

/**
 * A page's first sheet with the copy on the paper and a card's art beside it in a brass frame (`ArtPlate`), as the
 * opening screens frame their land vistas: a banner across the top on phones and tablets, a 4:3 plate on the right
 * from `lg`. The saved deck page and its editor open on it (owner, 2026-11-21). No copy sits on the art.
 *
 * An art crop carries no artist line of its own, so without `art` and `credit` there is no plate: uncredited art is
 * worse than none. Card art crops are hotlinked from Scryfall, so they pass `unoptimized`.
 */
export function ArtPortraitHeader({
  art,
  credit,
  labelledBy,
  position = "object-[center_25%]",
  className,
  children,
}: {
  art: string | null | undefined;
  credit: ArtCreditInfo | null;
  /** The id of the heading that names the section. */
  labelledBy: string;
  /** A Tailwind `object-*` class choosing which part of the art stays in frame. */
  position?: string;
  /** Layout of the copy column. */
  className?: string;
  children: ReactNode;
}) {
  const shown = art && credit;
  return (
    <section
      aria-labelledby={labelledBy}
      className={cn("sheet grid gap-5 p-4 sm:p-6 lg:gap-8 lg:p-8", shown && "lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]")}
    >
      {shown && (
        <ArtPlate
          src={art}
          credit={credit}
          sizes="(min-width: 1024px) 24rem, 100vw"
          position={position}
          priority
          unoptimized
          className="aspect-[16/7] lg:order-last lg:aspect-[4/3] lg:self-start"
        />
      )}
      <div className={cn("flex min-w-0 flex-col justify-center", className)}>{children}</div>
    </section>
  );
}
