import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * SEO-tool crawlers: they bring no visitors, only feed backlink tools. AhrefsBot is shut out (and denied by the
 * Vercel Firewall) after it fetched about 25 GB of share images in two days (2026-11-22/23); the rest may read pages
 * slowly but never the share images, which render on first request.
 */
const BLOCKED_BOTS = ["AhrefsBot"];
const SEO_BOTS = ["SemrushBot", "MJ12bot", "DotBot", "BLEXBot", "DataForSeoBot"];
/** Seconds between an SEO bot's requests: at most about 8,600 pages a day. */
const SEO_BOT_CRAWL_DELAY_S = 10;
/** Every share image (card, commander, saved deck), with or without Next's `?<hash>` suffix. */
const SHARE_IMAGES = "/*/opengraph-image";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // The deck tool stays crawlable so its noindex is seen; API routes aren't pages.
      { userAgent: "*", allow: "/", disallow: "/api/" },
      { userAgent: BLOCKED_BOTS, disallow: "/" },
      { userAgent: SEO_BOTS, disallow: ["/api/", SHARE_IMAGES], crawlDelay: SEO_BOT_CRAWL_DELAY_S },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
