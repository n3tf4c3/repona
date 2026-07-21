import type { NextConfig } from "next";

// Headers de hardening: defesa em profundidade contra clickjacking, sniffing de
// MIME e vazamento de referrer. A Content-Security-Policy completa (default-src/
// script-src/style-src/connect-src com nonce por requisição) é definida no
// proxy, que é onde o nonce pode ser gerado por request. (auditoria #34)
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  // @repona/core é distribuído como TypeScript (workspace); o Next precisa transpilá-lo.
  transpilePackages: ["@repona/core"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
