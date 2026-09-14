import Link from "next/link";
import { mockCards } from "@mtg/core/mocks";
import type { CardSummary } from "@mtg/core/contract";
import { CardImage } from "@/components/cards/card-image";
import { buttonVariants } from "@/components/ui/button";

function sampleCard(name: string): CardSummary {
  const card = mockCards.find((c) => c.name === name);
  if (!card) throw new Error(`Sample card missing from fixtures: ${name}`);
  return card;
}

// A binder page from a Chulane deck, with one pocket mid-swap.
const POCKETS: (CardSummary | "swap")[] = [
  sampleCard("Chulane, Teller of Tales"),
  sampleCard("Rhystic Study"),
  sampleCard("Cultivate"),
  sampleCard("Birds of Paradise"),
  "swap",
  sampleCard("Counterspell"),
  sampleCard("Sol Ring"),
  sampleCard("Beast Whisperer"),
  sampleCard("Arcane Signet"),
];
const SWAP_FROM = sampleCard("Swords to Plowshares");
const SWAP_TO = sampleCard("Path to Exile");
const POCKET_SIZES = "(min-width: 768px) 140px, 30vw";

const jobs = [
  {
    title: "Cut",
    body: "Spot cards that don't pull their weight, fall outside your colors, or push the deck past its bracket.",
  },
  {
    title: "Add",
    body: "See what decks with your commander play that yours doesn't.",
  },
  {
    title: "Replace",
    body: "Tap any card to compare it with cards that do the same job, and what the swap costs.",
  },
];

export default function Home() {
  return (
    <div className="flex flex-col gap-12 py-4 md:py-10">
      <section className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,27rem)] md:gap-12">
        <div className="max-w-xl">
          <h1 className="font-heading text-5xl leading-[0.92] font-extrabold tracking-tight sm:text-6xl">
            Better cards for your Commander deck
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Paste a decklist to see what to cut, what to add, and which cards could do the same job. No account needed.
          </p>
          <Link href="/deck" className={buttonVariants({ size: "lg", className: "mt-6 h-11 px-5 text-base" })}>
            Paste a decklist
          </Link>
        </div>

        {/* Decorative binder page: seams between pockets are the grid gaps. */}
        <div aria-hidden className="mx-auto w-full max-w-[22rem] rounded-2xl bg-seam p-px md:max-w-none">
          <ul className="grid grid-cols-3 gap-px overflow-hidden rounded-[calc(1rem-1px)]">
            {POCKETS.map((pocket, i) => (
              <li key={i} className="bg-sleeve p-2">
                {pocket === "swap" ? (
                  <div className="relative">
                    <CardImage card={SWAP_FROM} alt="" sizes={POCKET_SIZES} className="-rotate-6 opacity-60 saturate-50" />
                    <CardImage
                      card={SWAP_TO}
                      alt=""
                      sizes={POCKET_SIZES}
                      eager
                      className="absolute inset-0 translate-x-2 -translate-y-2 rotate-3 shadow-[0_0_0_2px_var(--color-primary)]"
                    />
                  </div>
                ) : (
                  <CardImage card={pocket} alt="" sizes={POCKET_SIZES} eager={i < 3} />
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-label="What you get" className="grid gap-6 border-t border-seam pt-8 sm:grid-cols-3">
        {jobs.map((job) => (
          <div key={job.title}>
            <h2 className="font-heading text-3xl leading-none font-extrabold tracking-tight">{job.title}</h2>
            <p className="mt-2 max-w-prose text-muted-foreground">{job.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
