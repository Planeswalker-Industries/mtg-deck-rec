import type { Metadata } from "next";
import { CollectionTool } from "@/components/collection/collection-tool";

export const metadata: Metadata = {
  title: "My collection",
  description: "Import your Magic collection so the deck tool can suggest cards you own.",
  // A collection is personal and lives in the visitor's browser; nothing here is worth indexing.
  robots: { index: false, follow: true },
};

export default function CollectionPage() {
  return <CollectionTool />;
}
