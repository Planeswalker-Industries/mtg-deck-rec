import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { cn } from "cn";
import { PocketGrid } from "@/components/cards/pocket-grid";
import { buttonVariants } from "@/components/ui/button";
import { GameChangerBadge } from "@/components/deck/card-label";
import { ColorIdentity } from "@/components/deck/color-identity";
import { displayName } from "@/lib/cards";
import { formatAsOf, formatPercent, formatUsd } from "@/lib/format";
import { cardCategoryLabel, commanderDecksPhrase, fewDecksPhrase, formatDeckCount } from "@/lib/labels";
import { getCommanderPage } from "@/lib/server/recs-cache";

const WUBRG = "WUBRG";

export async function generateMetadata({ params }: PageProps<"/commander/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await getCommanderPage(slug);
  if (!page) return { title: "Commander not found", robots: { index: false, follow: true } };
  const names = page.key.commanders.map((c) => c.name).join(" and ");
  return {
    title: `${names} decks`,
    description: `The cards ${page.key.deckCount.toLocaleString("en-US")} ${names} Commander decks run most, by card type, and how much ramp, card advantage, removal and protection they play.`,
    alternates: { canonical: `/commander/${slug}` },
  };
}

export default function CommanderPage({ params }: PageProps<"/commander/[slug]">) {
  return (
    <Suspense fallback={<p role="status" className="text-sm text-muted-foreground">Loading commander…</p>}>
      <CommanderDetails params={params} />
    </Suspense>
  );
}

async function CommanderDetails({ params }: Pick<PageProps<"/commander/[slug]">, "params">) {
  const { slug } = await params;
  const page = await getCommanderPage(slug);
  if (!page) notFound();

  const { key, top, roleProfile, computedAt } = page;
  const names = key.commanders.map(displayName).join(" and ");
  const identity = [...WUBRG].filter((color) => key.commanders.some((c) => c.colorIdentity.includes(color))).join("");
  const art = key.commanders[0]?.images?.front.artCrop;

  return (
    <article className="flex flex-col gap-8">
      <header className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {art && (
            <Image
              src={art}
              alt=""
              width={192}
              height={140}
              unoptimized
              priority
              className="h-20 w-28 shrink-0 rounded-lg object-cover ring-1 ring-seam sm:h-28 sm:w-40"
            />
          )}
          <div className="min-w-0">
            <h1 className="font-heading text-4xl leading-none font-extrabold tracking-tight text-balance sm:text-5xl">{names}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ColorIdentity identity={identity} />
              <span>What {commanderDecksPhrase(key)} run</span>
            </p>
          </div>
        </div>
        {key.confidence !== "full" && (
          <p className="max-w-prose text-sm">{fewDecksPhrase(key)}, so these rankings can still shift as more decks come in.</p>
        )}
        <div>
          {/* Pair names run long, so the label wraps instead of running off a phone screen. */}
          <Link href="/deck" className={cn(buttonVariants({ size: "lg" }), "h-auto min-h-9 max-w-full py-2 text-center whitespace-normal")}>
            Upgrade your {names} deck
          </Link>
        </div>
      </header>

      {roleProfile.length > 0 && (
        <section aria-labelledby="roles-heading" className="flex flex-col gap-3">
          <h2 id="roles-heading" className="font-heading text-2xl font-extrabold tracking-tight">
            In a typical deck
          </h2>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {roleProfile.map(({ tag, avgPerDeck }) => (
              <div key={tag.id} className="rounded-lg border border-seam bg-sleeve px-3 py-2">
                <dt className="text-sm text-muted-foreground">{tag.label}</dt>
                <dd className="font-heading text-3xl font-extrabold tabular-nums">{avgPerDeck}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {top.groups.map((group) => (
        <section key={group.category} aria-labelledby={`top-${group.category}`} className="flex flex-col gap-2">
          <h2 id={`top-${group.category}`} className="font-heading text-2xl font-extrabold tracking-tight">
            {cardCategoryLabel[group.category]}
          </h2>
          <PocketGrid
            label={`Most played ${cardCategoryLabel[group.category].toLowerCase()}`}
            items={group.suggestions.map((s) => ({
              card: s.card,
              caption: (
                <span className="flex flex-col items-start gap-0.5">
                  {s.card.gameChanger && <GameChangerBadge />}
                  {s.corpus && <span className="text-muted-foreground tabular-nums">In {formatPercent(s.corpus.inclusionRate)} of decks</span>}
                  <span className="text-muted-foreground tabular-nums">{s.card.price ? `About ${formatUsd(s.card.price.usd)}` : "No price"}</span>
                </span>
              ),
            }))}
          />
        </section>
      ))}

      <footer className="flex max-w-prose flex-col gap-1 text-xs text-muted-foreground">
        <p>
          Based on {formatDeckCount(key.deckCount + (key.borrowedDeckCount ?? 0))} shared publicly on{" "}
          <a href="https://archidekt.com" className="underline underline-offset-2">
            Archidekt
          </a>
          , counted only since each card came out. Updated {formatAsOf(computedAt)}.
        </p>
        <p>Prices are Scryfall estimates and may be out of date.</p>
      </footer>
    </article>
  );
}
