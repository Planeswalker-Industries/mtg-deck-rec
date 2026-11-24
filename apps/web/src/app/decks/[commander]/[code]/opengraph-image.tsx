import { loadDeckPage } from "@/lib/server/deck-page";
import { createPublicClient } from "@/lib/server/supabase";
import { DECK_PLATE_CACHE_CONTROL, PLATE_CONTENT_TYPE, plateResponse } from "@/lib/server/share-plate";
import { OG_IMAGE_SIZE, SITE_NAME } from "@/lib/constants";

/**
 * A saved deck's share preview (T101): its lead commander's art in a gilded frame beside the wordmark. Read as a
 * stranger, so a private deck 404s here too. A deck with no commander shares the hero instead (page.tsx), and 404s.
 */

export const size = OG_IMAGE_SIZE;
export const contentType = PLATE_CONTENT_TYPE;
export const alt = `A commander's art in a gilded frame, with the ${SITE_NAME} wordmark`;

export default async function Image({ params }: { params: Promise<{ commander: string; code: string }> }) {
  const { code } = await params;
  const deck = await loadDeckPage(createPublicClient(), code, null);
  const lead = deck?.commanders[0];
  if (!deck || !lead) return new Response(null, { status: 404 });
  return plateResponse(lead.images?.front.artCrop, deck.artists[lead.id] ?? null, DECK_PLATE_CACHE_CONTROL);
}
