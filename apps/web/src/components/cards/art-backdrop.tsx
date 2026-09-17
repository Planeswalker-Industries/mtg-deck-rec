import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";

/**
 * A card's art behind a page header, with the credit Scryfall's guidelines ask for.
 *
 * An art crop carries no artist or copyright line of its own — unlike a full card image, where the line is
 * part of the picture — so the credit has to be rendered next to it. Without an `artist` the art is not
 * shown at all: uncredited art is worse than none.
 *
 * The art is dimmed from below so the header text stays readable over any painting, dark or bright.
 */
export function ArtBackdrop({
  art,
  artist,
  cardName,
  cardSlug,
  children,
}: {
  art: string | undefined;
  artist: string | null | undefined;
  cardName: string;
  cardSlug: string;
  children: React.ReactNode;
}) {
  if (!art || !artist) return <>{children}</>;

  return (
    <div className="relative -mx-4 overflow-hidden rounded-none sm:mx-0 sm:rounded-xl">
      <Image
        src={art}
        alt=""
        width={1200}
        height={880}
        sizes="(min-width: 1024px) 64rem, 100vw"
        unoptimized
        priority
        className="absolute inset-0 size-full object-cover object-center"
      />
      {/*
       * Two layers, and they multiply: a flat wash for contrast everywhere, then a gradient that is
       * heaviest at the bottom where the credit and buttons sit. Keep the combined alpha near 0.7 behind
       * text — stacking two heavy layers reaches ~0.93 and the art stops reading at all.
       */}
      <div aria-hidden className="absolute inset-0 bg-background/30" />
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/55 to-background/30" />

      <div className="relative p-4 sm:p-6">
        {children}
        <p className="mt-4 text-xs text-muted-foreground">
          Art from{" "}
          <Link href={`/card/${cardSlug}` as Route} className="underline underline-offset-2 hover:text-foreground">
            {cardName}
          </Link>{" "}
          by {artist}
        </p>
      </div>
    </div>
  );
}
