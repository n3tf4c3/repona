import type { NextConfig } from "next";

// Headers de hardening (auditoria #34): defesa em profundidade contra
// clickjacking, sniffing de MIME e vazamento de referrer. A CSP inclui as
// diretivas que endurecem sem depender de nonce (object-src/base-uri/form-action
// não quebram o inline do Next). Uma política completa de script-src/style-src
// com nonce fica para uma etapa dedicada (primeiro em Report-Only) para não
// quebrar o inline do Next. (auditoria #34, parcial)
// Sem default-src/script-src/style-src de propósito: restringi-los sem 'unsafe-
// inline'/nonce quebraria o inline de hidratação/estilo do Next. As diretivas
// abaixo endurecem sem afetar script/style. (auditoria #34, parcial)
const csp = [
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // @repona/core é distribuído como TypeScript (workspace); o Next precisa transpilá-lo.
  transpilePackages: ["@repona/core"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
