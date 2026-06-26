import type { NextConfig } from "next";

// Headers de hardening (auditoria #34): defesa em profundidade contra
// clickjacking, sniffing de MIME e vazamento de referrer. CSP fica restrito a
// frame-ancestors por ora — uma política de script/style completa exige nonces
// e fica para uma etapa dedicada para não quebrar o inline do Next.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  // @repona/core é distribuído como TypeScript (workspace); o Next precisa transpilá-lo.
  transpilePackages: ["@repona/core"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
