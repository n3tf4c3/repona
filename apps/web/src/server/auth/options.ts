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

        const [usuario] = await db
          .select({
            id: usuarios.id,
            nome: usuarios.nome,
            email: usuarios.email,
            senhaHash: usuarios.senhaHash,
          })
          .from(usuarios)
          .where(eq(sql`lower(${usuarios.email})`, parsed.data.email.toLowerCase()))
          .limit(1);

        if (!usuario) return null;

        const ok = await verifyPassword(parsed.data.password, usuario.senhaHash);
        if (!ok) return null;

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
