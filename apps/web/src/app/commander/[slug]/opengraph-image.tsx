import { getCommanderPage } from "@/lib/server/recs-cache";
import { PLATE_CONTENT_TYPE, plateResponse } from "@/lib/server/share-plate";
import { OG_IMAGE_SIZE, SITE_NAME } from "@/lib/constants";

/** The commander page's share preview (T101): the lead commander's art in a gilded frame beside the wordmark. */

export const size = OG_IMAGE_SIZE;
export const contentType = PLATE_CONTENT_TYPE;
export const alt = `A commander's art in a gilded frame, with the ${SITE_NAME} wordmark`;

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await getCommanderPage(slug);
  if (!page) return new Response(null, { status: 404 });
  const lead = page.key.commanders[0];
  return plateResponse(lead?.images?.front.artCrop, lead ? (page.artists[lead.id] ?? null) : null);
}
