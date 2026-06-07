import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { z } from "zod";
import { autenticarCasa } from "@/server/modules/casa";

const loginSchema = z.object({
  token: z.string().trim().toUpperCase().regex(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/),
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
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const casa = await autenticarCasa(parsed.data.token);
        if (!casa) return null;

        // session.user.id passa a ser o casaId (a conta = a casa).
        return { id: String(casa.id), name: casa.name };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.name = user.name;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        session.user.name = token.name ?? null;
      }
      return session;
    },
  },
};
