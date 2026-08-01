import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,

  experimental: {
    // React <ViewTransition>: directional route animation without an
    // animation runtime on the client.
    viewTransition: true,
    // Barrel-file elision so importing three icons doesn't pull the set.
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
