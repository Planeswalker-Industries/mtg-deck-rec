import Image from "next/image";
import { cn } from "cn";

/**
 * Where the copy sits decides where the art is washed down:
 * - `left`: copy on the left, art showing through on the right (the hero).
 * - `bottom`: copy at the foot of a panel, art showing at the top.
 * Each wash also fades into the page at the bottom edge, so a band ends on the table colour, not on a cut.
 */
const WASHES = {
  left: [
    "bg-background/25",
    "bg-gradient-to-r from-background via-background/65 to-background/20",
    "bg-gradient-to-t from-background via-transparent to-background/40",
  ],
  bottom: ["bg-background/30", "bg-gradient-to-t from-background via-background/75 to-background/10"],
} as const;

/**
 * Land art laid behind a section. Decorative: the credit lives next to it in the page (see `lib/landing-art.ts`).
 * The parent must be `relative isolate`; the layer sits at `-z-10` inside it.
 *
 * With `washOver`, the washes leave the art's layer and sit at `z-10`, over the section's own content, so decoration
 * (the hero's cards) sinks into them like the art does. Anything that must stay readable then needs `z-20`.
 */
export function ArtBackdrop({
  src,
  wash,
  sizes,
  priority = false,
  position = "object-center",
  washOver = false,
}: {
  src: string;
  wash: keyof typeof WASHES;
  sizes: string;
  priority?: boolean;
  /** A Tailwind `object-*` class choosing which part of the art stays in frame. */
  position?: string;
  /** Lay the washes over the section's content instead of under it. */
  washOver?: boolean;
}) {
  const washes = WASHES[wash].map((layer) => <div key={layer} className={cn("absolute inset-0", layer)} />);
  return (
    <>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <Image src={src} alt="" fill priority={priority} sizes={sizes} className={cn("object-cover", position)} />
        {!washOver && washes}
      </div>
      {washOver && (
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
          {washes}
        </div>
      )}
    </>
  );
}
