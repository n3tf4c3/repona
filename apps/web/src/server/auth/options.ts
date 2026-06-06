import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/server/db";
import { usuarios } from "@/server/db/schema";
import { verifyPassword } from "@/server/auth/password";

const loginSchema = z.object({
  email: z.string().trim().email().max(160),
  password: z.string().min(1).max(200),
});

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

function isLoginBlocked(email: string): boolean {
  const attempt = loginAttempts.get(email);
  if (!attempt) return false;
  if (attempt.resetAt <= Date.now()) {
    loginAttempts.delete(email);
    return false;
  }
  return attempt.count >= MAX_LOGIN_ATTEMPTS;
}

function recordFailedLogin(email: string) {
  const now = Date.now();
  const attempt = loginAttempts.get(email);
  if (!attempt || attempt.resetAt <= now) {
    loginAttempts.set(email, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  loginAttempts.set(email, { ...attempt, count: attempt.count + 1 });
}

export const authOptions: NextAuthOptions = {
  // Getter: valida o segredo em runtime (quando o NextAuth o lê), não no build.
  get secret() {
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET ausente.");
    return secret;
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 8,
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const email = parsed.data.email.toLowerCase();

        if (isLoginBlocked(email)) return null;

        const [usuario] = await db
          .select({
            id: usuarios.id,
            nome: usuarios.nome,
            email: usuarios.email,
            senhaHash: usuarios.senhaHash,
          })
          .from(usuarios)
          .where(eq(sql`lower(${usuarios.email})`, email))
          .limit(1);

        if (!usuario) {
          recordFailedLogin(email);
          return null;
        }

        const ok = await verifyPassword(parsed.data.password, usuario.senhaHash);
        if (!ok) {
          recordFailedLogin(email);
          return null;
        }

        loginAttempts.delete(email);

        return {
          id: String(usuario.id),
          name: usuario.nome ?? usuario.email,
          email: usuario.email,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
