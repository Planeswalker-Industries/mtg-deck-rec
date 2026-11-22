import type { Metadata } from "next";
import { Suspense } from "react";
import { SharedCollectionView } from "@/components/collection/collection-view";
import { getSharedCollectionCopies } from "@/lib/server/recs-cache";
import { shareMetadata } from "@/lib/share-metadata";

/** Never indexed: a collection is shared by its link, not found through search. */
const ROBOTS: Metadata["robots"] = { index: false, follow: false };

/**
 * Someone's shared collection, read-only. proxy.ts answers a link that isn't shared with a real 404 and sends the
 * owner to /collection, so the page only renders for a visitor with a working link. The link preview names the
 * collection's size, never its owner or its cards.
 */
export async function generateMetadata({ params }: PageProps<"/collection/[code]">): Promise<Metadata> {
  const { code } = await params;
  const copies = await getSharedCollectionCopies(code);
  if (copies === null) return { title: "Shared collection", robots: ROBOTS };
  const title = `A collection of ${copies.toLocaleString("en-US")} card${copies === 1 ? "" : "s"}`;
  const description = `${title} on Spell Chasm. See which Commander decks it can build.`;
  return { title, description, robots: ROBOTS, ...shareMetadata({ title, description }) };
}

export default function SharedCollectionPage({ params }: PageProps<"/collection/[code]">) {
  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Loading collection…
        </p>
      }
    >
      <SharedCollection params={params} />
    </Suspense>
  );
}

async function SharedCollection({ params }: Pick<PageProps<"/collection/[code]">, "params">) {
  const { code } = await params;
  return <SharedCollectionView code={code} />;
}
