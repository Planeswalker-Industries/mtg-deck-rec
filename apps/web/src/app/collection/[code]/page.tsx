import type { Metadata } from "next";
import { Suspense } from "react";
import { SharedCollectionView } from "@/components/collection/collection-view";

/**
 * Someone's shared collection, read-only. proxy.ts answers a link that isn't shared with a real 404 and sends the
 * owner to /collection, so the page only renders for a visitor with a working link. Never indexed: a collection is
 * shared by its link, not found through search.
 */
export const metadata: Metadata = {
  title: "Shared collection",
  robots: { index: false, follow: false },
};

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
