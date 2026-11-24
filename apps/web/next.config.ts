import type { NextConfig } from "next";

// 31 days: public files keep their name only while their content stays the same; a changed image gets a new name.
const IMAGE_CACHE_TTL_S = 2_678_400;

const nextConfig: NextConfig = {
  // Public pages must prerender a static shell and stay indexable; uncached reads go behind <Suspense>.
  cacheComponents: true,
  typedRoutes: true,
  // `next dev` would otherwise write AGENTS.md and CLAUDE.md into apps/web; the repo keeps one CLAUDE.md at the root.
  agentRules: false,
  images: {
    // Scryfall images are hotlinked `unoptimized` (browsers fetch them from Scryfall, so they cost no Vercel transfer).
    // The optimizer serves only the local files in `localPatterns`; a new optimized local image needs a pattern here
    // or it 400s in production.
    localPatterns: [
      { pathname: "/*_hi_res.jpg", search: "" },
      { pathname: "/*_high_res.jpg", search: "" },
      { pathname: "/card_lg.png", search: "" },
      { pathname: "/logo-stacked.png", search: "" },
      { pathname: "/home/home_png_*.png", search: "" },
    ],
    // AVIF is about 20% smaller than WebP, and the few local sources make the extra transformations negligible.
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: IMAGE_CACHE_TTL_S,
  },
};

export default nextConfig;
