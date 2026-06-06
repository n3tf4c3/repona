import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";
import { usuarios } from "../../src/server/db/schema";

config({ path: ".env.local" });
config({ path: ".env" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente. Configure .env.local.");

  const email = (process.env.SEED_EMAIL ?? "").trim().toLowerCase();
  const senha = process.env.SEED_PASSWORD ?? "";
  const nome = process.env.SEED_NOME ?? "Usuário";
  if (!email || !senha) {
    throw new Error("Defina SEED_EMAIL e SEED_PASSWORD no .env.local.");
  }

  const db = drizzle({ client: neon(url) });
  const senhaHash = await bcrypt.hash(senha, 12);

  // Upsert idempotente por e-mail (case-insensitive), igual ao login.
  const [existente] = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .where(sql`lower(${usuarios.email}) = ${email}`)
    .limit(1);

  if (existente) {
    await db
      .update(usuarios)
      .set({ nome, senhaHash })
      .where(sql`${usuarios.id} = ${existente.id}`);
    console.log(`Usuário atualizado: ${email}`);
  } else {
    await db.insert(usuarios).values({ nome, email, senhaHash });
    console.log(`Usuário criado: ${email}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
