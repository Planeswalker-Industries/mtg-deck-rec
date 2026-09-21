import type { Metadata } from "next";
import { CollectionTool } from "@/components/collection/collection-tool";

export const metadata: Metadata = {
  title: "Import your collection",
  description: "Import your Magic collection so the deck tool can suggest cards you own.",
  // A collection is personal and lives in the visitor's browser or account; nothing here is worth indexing.
  robots: { index: false, follow: true },
};

export default function CollectionImportPage() {
  return <CollectionTool />;
}
