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
 */
export function ArtBackdrop({
  src,
  wash,
  sizes,
  priority = false,
  position = "object-center",
}: {
  src: string;
  wash: keyof typeof WASHES;
  sizes: string;
  priority?: boolean;
  /** A Tailwind `object-*` class choosing which part of the art stays in frame. */
  position?: string;
}) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <Image src={src} alt="" fill priority={priority} sizes={sizes} className={cn("object-cover", position)} />
      {WASHES[wash].map((layer) => (
        <div key={layer} className={cn("absolute inset-0", layer)} />
      ))}
    </div>
  );
}
