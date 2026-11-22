import type { Metadata } from "next";
import { DEFAULT_OG_IMAGE, SITE_NAME } from "@/lib/constants";

/** A preview image: an absolute URL, or a path resolved against the root layout's `metadataBase`. */
export interface ShareImage {
  url: string;
  width?: number;
  height?: number;
  alt: string;
}

/**
 * The `openGraph` and `twitter` blocks for a page with its own preview text or image. Next replaces a parent's
 * `openGraph` object whole rather than merging it, so a page that set `openGraph` itself would drop the site name and
 * the default image; every page that sets one goes through here instead. Without `image`, the hero is shared.
 */
export function shareMetadata(o: { title: string; description: string; image?: ShareImage }): Pick<Metadata, "openGraph" | "twitter"> {
  const image = o.image ?? DEFAULT_OG_IMAGE;
  return {
    openGraph: { title: o.title, description: o.description, siteName: SITE_NAME, type: "website", images: [image] },
    twitter: { card: "summary_large_image", title: o.title, description: o.description, images: [image.url] },
  };
}
