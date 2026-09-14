import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public pages must prerender a static shell and stay indexable; uncached reads go behind <Suspense>.
  cacheComponents: true,
  typedRoutes: true,
  images: {
    // Card images are hotlinked from Scryfall's CDN and rendered `unoptimized`:
    // Scryfall already serves sized variants, so there's nothing to gain from re-encoding.
    remotePatterns: [new URL("https://cards.scryfall.io/**")],
  },
};

export default nextConfig;
