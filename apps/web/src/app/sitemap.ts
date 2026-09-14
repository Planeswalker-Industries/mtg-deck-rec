import type { MetadataRoute } from "next";
import { getSitemapSlugs } from "@/lib/server/recs-cache";
import { SITE_URL } from "@/lib/site";

/** Indexable pages: the home page, commander pages and card pages. The deck tool is noindex, so it's left out. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { cards, commanders } = await getSitemapSlugs();
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...commanders.map((slug) => ({ url: `${SITE_URL}/commander/${slug}`, changeFrequency: "daily" as const, priority: 0.8 })),
    ...cards.map((slug) => ({ url: `${SITE_URL}/card/${slug}`, changeFrequency: "weekly" as const, priority: 0.5 })),
  ];
}
