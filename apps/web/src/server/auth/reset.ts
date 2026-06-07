import "server-only";
import { randomBytes, createHash } from "crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { usuarios, passwordResetTokens } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { enviarEmailReset } from "@/server/auth/mailer";

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function baseUrl(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

// Solicita redefinição. Sempre retorna sem erro mesmo quando o e-mail não
// existe, para não revelar quais e-mails têm conta.
export async function solicitarReset(email: string): Promise<void> {
  const normalizado = email.trim().toLowerCase();
  const [usuario] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(sql`lower(${usuarios.email}) = ${normalizado}`)
    .limit(1);
  if (!usuario) return;

  const token = randomBytes(32).toString("hex");
  await db.insert(passwordResetTokens).values({
    usuarioId: usuario.id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  });

  await enviarEmailReset(normalizado, `${baseUrl()}/redefinir-senha?token=${token}`);
}

export async function redefinirSenha(token: string, novaSenha: string): Promise<void> {
  const tokenHash = hashToken(token);
  const [registro] = await db
    .select({ id: passwordResetTokens.id, usuarioId: passwordResetTokens.usuarioId })
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, new Date())
      )
    )
    .limit(1);
  if (!registro) throw new Error("TOKEN_INVALID");

  const senhaHash = await hashPassword(novaSenha);
  await db.update(usuarios).set({ senhaHash }).where(eq(usuarios.id, registro.usuarioId));
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, registro.id));
}
