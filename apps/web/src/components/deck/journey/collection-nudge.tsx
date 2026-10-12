import Link from "next/link";
import type { Route } from "next";
import { Library } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/** What the nudge says at each step that earns one: where owning the cards changes what the player sees. */
const COPY = {
  replace: {
    title: "Swap in cards you already own",
    body: "Swap looks through every card in print. Import your collection and it puts the cards you own first.",
  },
  review: {
    title: "Build this from your own cards",
    body: "Import your collection to see how much of this deck you already have, and which cards you'd still need.",
  },
} as const;

/**
 * A quiet offer to import a collection, for players who came in with only a decklist (paste-and-swipe needs none). Shown
 * below the step, never above it, so it costs the swipe view no height. The import returns to the deck (`href`).
 */
export function CollectionNudge({ href, step }: { href: Route; step: keyof typeof COPY }) {
  const { title, body } = COPY[step];
  return (
    <aside
      aria-labelledby={`collection-nudge-${step}`}
      className="flex flex-col gap-3 rounded-panel border border-seam bg-sleeve p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="max-w-prose">
        <h2 id={`collection-nudge-${step}`} className="font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
      <Link href={href} className={buttonVariants({ variant: "outline", size: "lg", className: "shrink-0 gap-2" })}>
        <Library aria-hidden className="size-4" />
        Import your collection
      </Link>
    </aside>
  );
}

/**
 * Done's offer for a player who has a collection: fit the round's deck to it (goal 1), keeping the cards they own and
 * building the rest from the collection.
 */
export function CollectionFitOffer({ onFit, disabled = false }: { onFit: () => void; disabled?: boolean }) {
  return (
    <aside
      aria-labelledby="collection-fit"
      className="flex flex-col gap-3 rounded-panel border border-seam bg-sleeve p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="max-w-prose">
        <h2 id="collection-fit" className="font-semibold">
          Make it from your cards
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Keep the cards of this deck you own, and fill the rest from your collection instead of buying them.
        </p>
      </div>
      <Button type="button" size="lg" variant="outline" className="shrink-0 gap-2" onClick={onFit} disabled={disabled}>
        <Library aria-hidden className="size-4" />
        Fit it to my collection
      </Button>
    </aside>
  );
}
