import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { usuarios } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import { criarCasa } from "@/server/modules/casa";

// Cria uma conta nova com a sua própria casa. O e-mail é único
// (case-insensitive) — verificamos antes para dar erro amigável, e a
// constraint do banco é o backstop em caso de corrida.
export async function registrarUsuario(input: {
  nome: string;
  email: string;
  senha: string;
}): Promise<{ id: number }> {
  const nome = input.nome.trim();
  const email = input.email.trim().toLowerCase();

  const [existente] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(sql`lower(${usuarios.email}) = ${email}`)
    .limit(1);
  if (existente) throw new Error("EMAIL_EXISTS");

  const senhaHash = await hashPassword(input.senha);
  const casaId = await criarCasa();

  const [usuario] = await db
    .insert(usuarios)
    .values({ casaId, nome: nome || null, email, senhaHash })
    .returning({ id: usuarios.id });

  return { id: usuario.id };
}
