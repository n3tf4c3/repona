// Limpeza one-shot das chaves de rate limit LEGADAS que interpolavam o token da
// casa em claro (auditoria #43).
//
// Contexto: antes do #43, as chaves login:token:/sync:token:/casa-del:token:
// gravavam o token literal em rate_limits.chave — um dump ou leitura do banco
// revelaria tokens ativos, contornando a cifragem de casas.invite_code_enc.
// Hoje o código só escreve o fingerprint HMAC-SHA-256 (base64url, 43 chars).
// Esta rotina remove qualquer linha legada remanescente e verifica contagem zero,
// SEM imprimir o valor de nenhuma chave (o sufixo legado é justamente o token).
//
// Como distinguir sem vazar: toda chave NOVA tem sufixo de exatamente 43 chars
// (fingerprint). Qualquer sufixo com comprimento != 43 sob esses prefixos é
// legado (código de casa de 8 chars, o bucket "invalido" ou input de login).
//
// Uso (da pasta apps/web):
//   node scripts/limpar-rate-limit-legado.mjs            dry-run (só conta)
//   node scripts/limpar-rate-limit-legado.mjs --yes      apaga e reverifica
//
// Da raiz do monorepo:  npm run rate-limit:limpar -w web -- --yes
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ausente. Configure apps/web/.env.local.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const confirmado = process.argv.slice(2).includes("--yes");

// Comprimento do fingerprint novo: base64url de 32 bytes = 43 chars (sem padding).
const FINGERPRINT_LEN = 43;
const PREFIXOS = ["login:token:", "sync:token:", "casa-del:token:"];

// Conta as linhas legadas por prefixo: mesmo prefixo das chaves novas, mas com
// sufixo de comprimento diferente de 43 (o fingerprint). char_length ignora o
// próprio prefixo via length(prefixo). Só devolve números — nunca a chave.
async function contarLegadas() {
  let total = 0;
  const porPrefixo = {};
  for (const prefixo of PREFIXOS) {
    const [{ n }] = await sql`
      SELECT count(*)::int AS n FROM rate_limits
      WHERE chave LIKE ${prefixo + "%"}
        AND char_length(chave) - ${prefixo.length} <> ${FINGERPRINT_LEN}
    `;
    porPrefixo[prefixo] = n;
    total += n;
  }
  return { total, porPrefixo };
}

async function apagarLegadas() {
  let total = 0;
  for (const prefixo of PREFIXOS) {
    const linhas = await sql`
      DELETE FROM rate_limits
      WHERE chave LIKE ${prefixo + "%"}
        AND char_length(chave) - ${prefixo.length} <> ${FINGERPRINT_LEN}
      RETURNING 1
    `;
    total += linhas.length;
  }
  return total;
}

const antes = await contarLegadas();
console.log("Chaves de rate limit legadas (token em claro) encontradas:");
for (const prefixo of PREFIXOS) console.log(`  ${prefixo}<...>  ${antes.porPrefixo[prefixo]}`);
console.log(`  total: ${antes.total}`);

if (antes.total === 0) {
  console.log("\nNada a limpar: nenhuma chave legada presente.");
  process.exit(0);
}

if (!confirmado) {
  console.log("\nDry-run. Rode com --yes para apagar e reverificar.");
  process.exit(0);
}

const apagadas = await apagarLegadas();
const depois = await contarLegadas();
console.log(`\nApagadas: ${apagadas}. Contagem legada após limpeza: ${depois.total}.`);
if (depois.total !== 0) {
  console.error("FALHA: ainda restam chaves legadas. Investigue antes de considerar resolvido.");
  process.exit(1);
}
console.log("OK: zero chaves legadas remanescentes.");
