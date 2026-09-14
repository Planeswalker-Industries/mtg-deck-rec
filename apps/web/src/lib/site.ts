/** Absolute site origin for the sitemap, robots file and canonical links. Set NEXT_PUBLIC_SITE_URL when deployed. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
