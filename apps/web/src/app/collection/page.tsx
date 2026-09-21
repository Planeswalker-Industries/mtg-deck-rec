import type { Metadata } from "next";
import { CollectionView } from "@/components/collection/collection-view";

export const metadata: Metadata = {
  title: "My collection",
  description: "Browse your Magic collection by name, what cards do, color and set.",
  // A collection is personal; nothing here is worth indexing.
  robots: { index: false, follow: true },
};

export default function CollectionPage() {
  return <CollectionView />;
}
