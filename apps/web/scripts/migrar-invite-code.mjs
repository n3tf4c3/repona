// Migração do token da casa para repouso cifrado (auditoria #43).
//
// Cifra os invite_code existentes (texto puro) na coluna nova invite_code_enc e
// remove a coluna antiga. Preserva os tokens atuais — NÃO rotaciona — então
// ninguém perde acesso. Roda uma vez, na janela de deploy, ANTES de subir o
// código novo (o app passa a ler invite_code_enc).
//
// Uso (da pasta apps/web):
//   node scripts/migrar-invite-code.mjs          mostra o plano (dry-run)
//   node scripts/migrar-invite-code.mjs --yes    executa a migração
//
// Em banco novo/vazio nada disto é necessário: db:push já cria invite_code_enc.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { cifrarCodigo } from "./inviteToken.mjs";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ausente. Configure apps/web/.env.local.");
  process.exit(1);
}
if (!process.env.INVITE_TOKEN_SECRET) {
  console.error("INVITE_TOKEN_SECRET ausente. Defina o mesmo segredo que o app usará.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);
const confirmado = process.argv.slice(2).includes("--yes");

async function colunaExiste(nome) {
  const r = await sql`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'casas' AND column_name = ${nome} LIMIT 1`;
  return r.length > 0;
}

async function main() {
  const temAntiga = await colunaExiste("invite_code");
  if (!temAntiga) {
    console.log("Coluna invite_code não existe: banco já migrado. Nada a fazer.");
    return;
  }

  const casas = await sql`SELECT id, invite_code FROM casas ORDER BY id`;
  console.log(`Casas a migrar: ${casas.length}`);

  if (!confirmado) {
    console.log("\nDRY-RUN. O plano:");
    console.log("  1. ADD COLUMN invite_code_enc");
    console.log(`  2. cifrar e gravar invite_code_enc de ${casas.length} casa(s)`);
    console.log("  3. SET NOT NULL + UNIQUE em invite_code_enc");
    console.log("  4. DROP COLUMN invite_code");
    console.log("\nPara executar: node scripts/migrar-invite-code.mjs --yes");
    return;
  }

  const passos = [sql`ALTER TABLE casas ADD COLUMN IF NOT EXISTS invite_code_enc text`];
  for (const c of casas) {
    passos.push(sql`UPDATE casas SET invite_code_enc = ${cifrarCodigo(c.invite_code)} WHERE id = ${c.id}`);
  }
  passos.push(sql`ALTER TABLE casas ALTER COLUMN invite_code_enc SET NOT NULL`);
  passos.push(sql`ALTER TABLE casas ADD CONSTRAINT casas_invite_code_enc_unique UNIQUE (invite_code_enc)`);
  passos.push(sql`ALTER TABLE casas DROP COLUMN invite_code`);

  await sql.transaction(passos);
  console.log(`\nMigração concluída: ${casas.length} token(s) cifrado(s); coluna invite_code removida.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
