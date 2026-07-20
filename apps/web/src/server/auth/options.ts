import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { autenticarCasa } from "@/server/modules/casa";
import { rateLimited } from "@/server/rateLimit";
import { fingerprintToken } from "@/server/rateLimitToken";
import { authSecret } from "@/server/env";

const loginSchema = z.object({
  token: z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/),
});

// Throttle do login (auditoria #20): o token de 8 chars é a única credencial da
// casa. Diferente de /api/sync e /api/casa, o fluxo de credentials do NextAuth
// não passava por rateLimited — tentativas online ficavam sem limite. Limita por
// IP e por token normalizado.
const LOGIN_JANELA_SEG = 60;
const LOGIN_MAX_POR_IP = 30;
const LOGIN_MAX_POR_TOKEN = 10;

export const authOptions: NextAuthOptions = {
  // Getter: valida o segredo em runtime (quando o NextAuth o lê), não no build.
  // Regra centralizada em server/env.ts. (auditoria #89)
  get secret() {
    return authSecret();
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 30,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Token",
      credentials: {
        token: { label: "Código de acesso", type: "text" },
      },
      // A credencial é o token (código da casa) gerado no mobile. Sem senha.
      async authorize(credentials, req) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        // Prefere x-real-ip (IP real da plataforma); o primeiro valor de
        // x-forwarded-for é forjável pelo cliente. (auditoria #32)
        const real = req?.headers?.["x-real-ip"];
        const xff = req?.headers?.["x-forwarded-for"];
        const fallback = typeof xff === "string" ? xff.split(",").map((p) => p.trim()).filter(Boolean).pop() : "";
        const ip = (typeof real === "string" && real.trim() ? real.trim() : fallback) || "desconhecido";
        if (await rateLimited(`login:ip:${ip}`, LOGIN_MAX_POR_IP, LOGIN_JANELA_SEG)) return null;
        // Fingerprint do token, não o token em claro, na chave persistida. (#43)
        if (
          await rateLimited(
            `login:token:${fingerprintToken(parsed.data.token, "login")}`,
            LOGIN_MAX_POR_TOKEN,
            LOGIN_JANELA_SEG
          )
        )
          return null;

        const casa = await autenticarCasa(parsed.data.token);
        if (!casa) return null;

        // session.user.id passa a ser o casaId (a conta = a casa).
        return { id: String(casa.id), name: casa.name, credentialVersion: casa.credentialVersion };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
        token.credentialVersion = user.credentialVersion;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.name = token.name ?? null;
        session.credentialVersion = token.credentialVersion;
      }
      return session;
    },
  },
};
