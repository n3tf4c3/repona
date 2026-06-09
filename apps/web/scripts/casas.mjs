// Ferramenta de administração das casas (contas) no banco.
//
// Uso (da pasta apps/web):
//   node scripts/casas.mjs list                 lista todas as casas + contadores
//   node scripts/casas.mjs show  <code|id>      detalha uma casa (produtos, etc.)
//   node scripts/casas.mjs delete <code|id>     mostra o que seria apagado (dry-run)
//   node scripts/casas.mjs delete <code|id> --yes   apaga de verdade (cascade)
//
// Da raiz do monorepo:  npm run casas -w web -- list
//
// A exclusão remove purchase_history primeiro (a FK product_id e' NO ACTION e
// bloquearia o DELETE da casa) e depois a casa — o resto cai por cascade
// (produtos, estoque, eventos, precos, listas e itens). Roda numa transacao.
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL ausente. Configure apps/web/.env.local.");
  process.exit(1);
}
const sql = neon(process.env.DATABASE_URL);

const [cmd, arg, ...rest] = process.argv.slice(2);
const confirmado = rest.includes("--yes");

// Resolve a casa por invite_code (8 chars) ou id numerico.
async function resolverCasa(ref) {
  if (!ref) return null;
  const porId = /^\d+$/.test(ref)
    ? await sql`SELECT id, name, invite_code FROM casas WHERE id = ${Number(ref)}`
    : [];
  if (porId.length) return porId[0];
  const code = ref.trim().toUpperCase();
  const porCode = await sql`SELECT id, name, invite_code FROM casas WHERE invite_code = ${code}`;
  return porCode[0] ?? null;
}

async function contadores(casaId) {
  const [r] = await sql`
    SELECT
      (SELECT count(*)::int FROM products WHERE casa_id = ${casaId}) AS produtos,
      (SELECT count(*)::int FROM products WHERE casa_id = ${casaId} AND archived) AS arquivados,
      (SELECT count(*)::int FROM purchase_history WHERE casa_id = ${casaId}) AS compras,
      (SELECT count(*)::int FROM shopping_lists WHERE casa_id = ${casaId}) AS listas,
      (SELECT count(*)::int FROM shopping_list_items WHERE casa_id = ${casaId}) AS itens_lista,
      (SELECT count(*)::int FROM price_history ph JOIN products p ON p.id = ph.product_id WHERE p.casa_id = ${casaId}) AS precos
  `;
  return r;
}

async function list() {
  const casas = await sql`SELECT id, name, invite_code, created_at FROM casas ORDER BY id`;
  if (!casas.length) return console.log("(nenhuma casa)");
  for (const c of casas) {
    const n = await contadores(c.id);
    const criada = new Date(c.created_at).toLocaleDateString("pt-BR");
    console.log(
      `#${c.id}  "${c.name}"  code=${c.invite_code}  criada=${criada}\n` +
        `      produtos=${n.produtos} (arq ${n.arquivados})  compras=${n.compras}  ` +
        `listas=${n.listas} (itens ${n.itens_lista})  precos=${n.precos}`,
    );
  }
}

async function show(ref) {
  const casa = await resolverCasa(ref);
  if (!casa) return console.error(`Casa "${ref}" nao encontrada.`);
  const n = await contadores(casa.id);
  console.log(`Casa #${casa.id} "${casa.name}" code=${casa.invite_code}`);
  console.log(`  ${JSON.stringify(n)}`);
  const prods = await sql`
    SELECT id, name, category, status, archived FROM products WHERE casa_id = ${casa.id}
    ORDER BY archived, name`;
  console.log(`  Produtos (${prods.length}):`);
  for (const p of prods) {
    console.log(`    #${p.id} "${p.name}" [${p.category}] ${p.status}${p.archived ? " (arquivado)" : ""}`);
  }
}

async function del(ref) {
  const casa = await resolverCasa(ref);
  if (!casa) return console.error(`Casa "${ref}" nao encontrada.`);
  const n = await contadores(casa.id);
  console.log(`Casa #${casa.id} "${casa.name}" code=${casa.invite_code}`);
  console.log(`  Sera apagado (cascade): ${JSON.stringify(n)}`);

  if (!confirmado) {
    console.log("\nDRY-RUN. Para apagar de verdade, repita com --yes:");
    console.log(`  node scripts/casas.mjs delete ${casa.invite_code} --yes`);
    return;
  }

  // purchase_history primeiro (FK NO ACTION); depois a casa (resto por cascade).
  await sql.transaction([
    sql`DELETE FROM purchase_history WHERE casa_id = ${casa.id}`,
    sql`DELETE FROM casas WHERE id = ${casa.id}`,
  ]);
  console.log(`\nCasa #${casa.id} apagada.`);
}

const comandos = { list, show: () => show(arg), delete: () => del(arg) };
const acao = comandos[cmd];
if (!acao) {
  console.log("Comandos: list | show <code|id> | delete <code|id> [--yes]");
  process.exit(cmd ? 1 : 0);
}
await acao();
