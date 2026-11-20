import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // publik's public app token is read at run time from the repo root; ship it with the server routes.
  outputFileTracingIncludes: { "/api/**": ["./publik-app-token.txt", "./publik-pending.txt", "./kit/publik-app-token.txt"] },
  poweredByHeader: false,
};

export default nextConfig;
