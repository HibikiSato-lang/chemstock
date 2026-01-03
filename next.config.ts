import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents: true, // Disabled: causes build errors with useSearchParams/useParams without Suspense boundaries
};

export default nextConfig;
