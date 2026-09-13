import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Public pages must prerender a static shell and stay indexable; uncached reads go behind <Suspense>.
  cacheComponents: true,
  typedRoutes: true,
};

export default nextConfig;
