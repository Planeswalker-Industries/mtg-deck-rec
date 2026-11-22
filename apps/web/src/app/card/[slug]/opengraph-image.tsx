import { getCardPage } from "@/lib/server/recs-cache";
import { PLATE_CONTENT_TYPE, plateResponse } from "@/lib/server/share-plate";
import { OG_IMAGE_SIZE, SITE_NAME } from "@/lib/constants";

/** The card page's share preview (T101): the card's art in a gilded frame beside the wordmark (`share-plate.tsx`). */

export const size = OG_IMAGE_SIZE;
export const contentType = PLATE_CONTENT_TYPE;
// A static alt can't carry the card's name, and generateImageMetadata would move the image off this URL.
export const alt = `A Magic card's art in a gilded frame, with the ${SITE_NAME} wordmark`;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getCardPage(slug);
  if (!page) return new Response(null, { status: 404 });
  // Scryfall's front art is a double-faced card's front face.
  return plateResponse(page.card.images?.front.artCrop, page.artist);
}
