// Mescla dois produtos duplicados de uma casa: reatribui todo o historico do
// duplicado (B) para o canonico (A), deduplica e apaga B. Serve para limpar
// duplicatas que o sync criou quando o mesmo item existia sob nomes diferentes
// (renomeacao / scanner). A nuvem e o ponto de convergencia: depois do merge,
// os celulares re-puxam o estado limpo.
//
// Uso (da pasta apps/web):
//   node scripts/merge-produtos.mjs <casa> <dup:id|nome> <canonico:id|nome>          dry-run
//   node scripts/merge-produtos.mjs <casa> <dup:id|nome> <canonico:id|nome> --yes    backup + merge
//
// Da raiz do monorepo:  npm run merge-produtos -w web -- <casa> <dup> <canonico> [--yes]
//
// O duplicado (B) e o que some; o canonico (A) e o que fica. purchase_history e
// shopping_list_items sao FK NO ACTION: reatribuidos/limpos antes do DELETE de B.
// price_history / inventory_events sao reatribuidos (preserva precos e consumo);
// inventory_items de B cai por cascade (A mantem o seu).
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cifrarCodigo, decifrarCodigo } from "./inviteToken.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));

// Sanitiza campos de dominio antes de imprimir (nomes aceitam qualquer caractere
// no cadastro): C0 (00-1F), DEL+C1 (7F-9F) e marcas bidi (202A-202E, 2066-2069)
// viram U+FFFD, para nao injetar ANSI/OSC/bidi no terminal de quem roda o CLI.
// Checagem por code point (sem caracteres de controle literais no fonte).
// (auditoria #97)
function limpar(valor) {
  return String(valor ?? "").replace(/./gsu, (ch) => {
    const c = ch.codePointAt(0);
    const controle = c <= 0x1f || (c >= 0x7f && c <= 0x9f);
    const bidi = (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    return controle || bidi ? "�" : ch;
  });
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ausente. Configure apps/web/.env.local.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const [casaRef, dupRef, canonRef, ...rest] = process.argv.slice(2);
const confirmado = rest.includes("--yes");

// invite_code é credencial: mascarado no stdout por padrão. (auditoria #38)
const revelarToken = rest.includes("--show-token");
function token(code) {
  if (revelarToken) return code;
  return code.length <= 4 ? "****" : `${code.slice(0, 2)}****${code.slice(-2)}`;
}

if (!casaRef || !dupRef || !canonRef) {
  console.log("Uso: node scripts/merge-produtos.mjs <casa> <dup:id|nome> <canonico:id|nome> [--yes]");
  process.exit(0);
}

async function resolverCasa(ref) {
  const porId = /^\d+$/.test(ref)
    ? await sql`SELECT id, name, invite_code_enc FROM casas WHERE id = ${Number(ref)}`
    : [];
  if (porId.length) return porId[0];
  const porCode = await sql`SELECT id, name, invite_code_enc FROM casas WHERE invite_code_enc = ${cifrarCodigo(ref.trim().toUpperCase())}`;
  return porCode[0] ?? null;
}

// Resolve produto por id numerico ou nome exato (case-insensitive) dentro da casa.
async function resolverProduto(casaId, ref) {
  if (/^\d+$/.test(ref)) {
    const r = await sql`SELECT id, name, archived, barcode FROM products WHERE casa_id = ${casaId} AND id = ${Number(ref)}`;
    return r[0] ?? null;
  }
  const r = await sql`SELECT id, name, archived, barcode FROM products
    WHERE casa_id = ${casaId} AND lower(name) = lower(${ref.trim()})`;
  if (r.length > 1) {
    console.error(`Nome "${limpar(ref)}" casa com ${r.length} produtos; use o id.`);
    process.exit(1);
  }
  return r[0] ?? null;
}

const casa = await resolverCasa(casaRef);
if (!casa) {
  console.error(`Casa "${casaRef}" nao encontrada.`);
  process.exit(1);
}
const B = await resolverProduto(casa.id, dupRef);
const A = await resolverProduto(casa.id, canonRef);
if (!B) { console.error(`Duplicado "${dupRef}" nao encontrado na casa.`); process.exit(1); }
if (!A) { console.error(`Canonico "${canonRef}" nao encontrado na casa.`); process.exit(1); }
if (A.id === B.id) { console.error("Duplicado e canonico sao o mesmo produto."); process.exit(1); }

async function contar(id) {
  // Compras contadas só as vivas (deleted = false): tombstones nao devem inflar
  // a metrica nem o purchase_count. (auditoria #86)
  const [r] = await sql`SELECT
    (SELECT count(*)::int FROM purchase_history WHERE product_id = ${id} AND deleted = false) AS compras,
    (SELECT count(*)::int FROM price_history WHERE product_id = ${id}) AS precos,
    (SELECT count(*)::int FROM inventory_events WHERE product_id = ${id}) AS consumos,
    (SELECT count(*)::int FROM shopping_list_items WHERE product_id = ${id}) AS itens_lista`;
  return r;
}
const cB = await contar(B.id);
const cA = await contar(A.id);

console.log(`Casa #${casa.id} "${limpar(casa.name)}" code=${token(decifrarCodigo(casa.invite_code_enc))}`);
console.log(`  DUPLICADO (some): #${B.id} "${limpar(B.name)}"${B.archived ? " [ARQ]" : ""}  ${JSON.stringify(cB)}`);
console.log(`  CANONICO (fica):  #${A.id} "${limpar(A.name)}"${A.archived ? " [ARQ]" : ""}  ${JSON.stringify(cA)}`);
console.log(`\n  -> compras/precos/consumos de #${B.id} viram de #${A.id} (deduplicados); itens de lista de #${B.id} sao removidos; #${B.id} e apagado.`);

if (!confirmado) {
  console.log(`\nDRY-RUN. Nada alterado. Para aplicar (com backup antes):`);
  console.log(`  node scripts/merge-produtos.mjs ${casa.id} ${B.id} ${A.id} --yes`);
  process.exit(0);
}

// Backup dos dois produtos e tudo que os referencia (rede de seguranca).
const ids = [A.id, B.id];
const dump = {
  exportadoEm: new Date().toISOString(),
  casa,
  canonico: A,
  duplicado: B,
  products: await sql`SELECT * FROM products WHERE id = ANY(${ids})`,
  purchase_history: await sql`SELECT * FROM purchase_history WHERE product_id = ANY(${ids}) ORDER BY id`,
  price_history: await sql`SELECT * FROM price_history WHERE product_id = ANY(${ids}) ORDER BY id`,
  inventory_events: await sql`SELECT * FROM inventory_events WHERE product_id = ANY(${ids}) ORDER BY id`,
  inventory_items: await sql`SELECT * FROM inventory_items WHERE product_id = ANY(${ids}) ORDER BY id`,
  shopping_list_items: await sql`SELECT * FROM shopping_list_items WHERE product_id = ANY(${ids}) ORDER BY id`,
};
// O dump traz dados da casa em JSON claro. Cria diretorio e arquivo com permissao
// restritiva (dono apenas, ~0700/0600) para nao herdar ACL de leitura ampla, o
// mesmo que casas.mjs faz. Em Windows o modo POSIX e best-effort; ainda assim
// mantenha o backup fora de compartilhamentos/backups. (auditoria #85)
const dir = resolve(aqui, "../backups");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = resolve(dir, `merge-${casa.id}-${B.id}-into-${A.id}-${stamp}.json`);
writeFileSync(file, JSON.stringify(dump, null, 2), { encoding: "utf8", mode: 0o600 });
console.log(`\nBackup salvo em:\n  ${file}`);
console.log("  AVISO: contem dados da casa em texto claro.");
console.log("  Guarde fora de compartilhamentos/backups e apague quando nao precisar mais.");

// Tudo numa transacao. Os DELETEs de dedupe mantem a linha de menor id por
// (instante ao segundo + quantidade/preco), mesma regra do dedupe do sync.
await sql.transaction([
  sql`UPDATE purchase_history SET product_id = ${A.id} WHERE product_id = ${B.id}`,
  sql`DELETE FROM purchase_history a
      WHERE a.product_id = ${A.id} AND EXISTS (
        SELECT 1 FROM purchase_history b
        WHERE b.product_id = ${A.id} AND b.id < a.id
          AND trim(b.quantity) = trim(a.quantity)
          AND date_trunc('second', b.purchased_at) = date_trunc('second', a.purchased_at))`,
  sql`UPDATE price_history SET product_id = ${A.id} WHERE product_id = ${B.id}`,
  sql`DELETE FROM price_history a
      WHERE a.product_id = ${A.id} AND EXISTS (
        SELECT 1 FROM price_history b
        WHERE b.product_id = ${A.id} AND b.id < a.id
          AND b.price_cents = a.price_cents
          AND date_trunc('second', b.recorded_at) = date_trunc('second', a.recorded_at))`,
  sql`UPDATE inventory_events SET product_id = ${A.id} WHERE product_id = ${B.id}`,
  // Deduplica consumos reatribuidos, mesma regra do dedupe do sync (mesmo tipo +
  // quantidade + instante ao segundo). Antes o script so reatribuia
  // inventory_events sem deduplicar, entao consumos iguais dos dois produtos
  // acumulavam. (auditoria #86)
  sql`DELETE FROM inventory_events a
      WHERE a.product_id = ${A.id} AND EXISTS (
        SELECT 1 FROM inventory_events b
        WHERE b.product_id = ${A.id} AND b.id < a.id
          AND b.event_type = a.event_type
          AND trim(b.quantity) = trim(a.quantity)
          AND date_trunc('second', b.occurred_at) = date_trunc('second', a.occurred_at))`,
  sql`DELETE FROM shopping_list_items WHERE product_id = ${B.id}`,
  sql`DELETE FROM products WHERE id = ${B.id}`,
  sql`UPDATE products SET purchase_count = (
        SELECT count(*) FROM purchase_history WHERE product_id = ${A.id} AND deleted = false
      ) WHERE id = ${A.id}`,
]);

const cFinal = await contar(A.id);
console.log(`\nMerge concluido. #${A.id} "${limpar(A.name)}" agora: ${JSON.stringify(cFinal)}`);
console.log(`#${B.id} "${limpar(B.name)}" apagado. (re-puxe no celular para refletir)`);
