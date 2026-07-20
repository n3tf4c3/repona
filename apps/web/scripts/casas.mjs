// Ferramenta de administração das casas (contas) no banco.
//
// Uso (da pasta apps/web):
//   node scripts/casas.mjs list                 lista todas as casas + contadores
//   node scripts/casas.mjs show  <code|id>      detalha uma casa (produtos, etc.)
//   node scripts/casas.mjs export <code|id>     dump JSON da casa em backups/ (rede de seguranca)
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
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cifrarCodigo, decifrarCodigo } from "./inviteToken.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));

// Sanitiza campos de dominio antes de imprimir no terminal: nomes de casa/produto
// aceitam qualquer caractere no cadastro, entao um usuario com token/criacao
// publica poderia injetar C0/C1/ANSI/OSC ou marcas bidi para adulterar a
// exibicao, links ou clipboard de quem roda o CLI. (auditoria #97)
//
// Checagem por code point (sem caracteres de controle literais no fonte, que um
// editor/git poderia alterar silenciosamente): C0 (00-1F), DEL+C1 (7F-9F) e
// marcas bidi perigosas (202A-202E, 2066-2069) viram U+FFFD.
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

const [cmd, arg, ...rest] = process.argv.slice(2);
const confirmado = rest.includes("--yes");

// O invite_code é a credencial da casa: por padrão é mascarado no stdout e nos
// nomes de backup, para não vazar em logs/CI/prints. --show-token revela.
// (auditoria #38)
const revelarToken = rest.includes("--show-token");
if (revelarToken) console.warn("AVISO: --show-token exibe a credencial da casa em texto puro.\n");
function token(code) {
  if (revelarToken) return code;
  return code.length <= 4 ? "****" : `${code.slice(0, 2)}****${code.slice(-2)}`;
}

// Resolve a casa por invite_code (8 chars) ou id numerico.
async function resolverCasa(ref) {
  if (!ref) return null;
  const porId = /^\d+$/.test(ref)
    ? await sql`SELECT id, name, invite_code_enc FROM casas WHERE id = ${Number(ref)}`
    : [];
  if (porId.length) return porId[0];
  const code = ref.trim().toUpperCase();
  const porCode = await sql`SELECT id, name, invite_code_enc FROM casas WHERE invite_code_enc = ${cifrarCodigo(code)}`;
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
  const casas = await sql`SELECT id, name, invite_code_enc, created_at FROM casas ORDER BY id`;
  if (!casas.length) return console.log("(nenhuma casa)");
  for (const c of casas) {
    const n = await contadores(c.id);
    const criada = new Date(c.created_at).toLocaleDateString("pt-BR");
    console.log(
      `#${c.id}  "${limpar(c.name)}"  code=${token(decifrarCodigo(c.invite_code_enc))}  criada=${criada}\n` +
        `      produtos=${n.produtos} (arq ${n.arquivados})  compras=${n.compras}  ` +
        `listas=${n.listas} (itens ${n.itens_lista})  precos=${n.precos}`,
    );
  }
}

async function show(ref) {
  const casa = await resolverCasa(ref);
  if (!casa) return console.error(`Casa "${limpar(ref)}" nao encontrada.`);
  const n = await contadores(casa.id);
  console.log(`Casa #${casa.id} "${limpar(casa.name)}" code=${token(decifrarCodigo(casa.invite_code_enc))}`);
  console.log(`  ${JSON.stringify(n)}`);
  const prods = await sql`
    SELECT id, name, category, status, archived FROM products WHERE casa_id = ${casa.id}
    ORDER BY archived, name`;
  console.log(`  Produtos (${prods.length}):`);
  for (const p of prods) {
    console.log(`    #${p.id} "${limpar(p.name)}" [${limpar(p.category)}] ${p.status}${p.archived ? " (arquivado)" : ""}`);
  }
}

async function exportar(ref) {
  const casa = await resolverCasa(ref);
  if (!casa) return console.error(`Casa "${limpar(ref)}" nao encontrada.`);
  const id = casa.id;
  const prodIds = (await sql`SELECT id FROM products WHERE casa_id = ${id}`).map((r) => r.id);
  const dump = {
    exportadoEm: new Date().toISOString(),
    casa: (await sql`SELECT * FROM casas WHERE id = ${id}`)[0],
    products: await sql`SELECT * FROM products WHERE casa_id = ${id} ORDER BY id`,
    inventory_items: await sql`SELECT * FROM inventory_items WHERE product_id = ANY(${prodIds}) ORDER BY id`,
    inventory_events: await sql`SELECT * FROM inventory_events WHERE product_id = ANY(${prodIds}) ORDER BY id`,
    price_history: await sql`SELECT * FROM price_history WHERE product_id = ANY(${prodIds}) ORDER BY id`,
    purchase_history: await sql`SELECT * FROM purchase_history WHERE casa_id = ${id} ORDER BY id`,
    shopping_lists: await sql`SELECT * FROM shopping_lists WHERE casa_id = ${id} ORDER BY id`,
    shopping_list_items: await sql`SELECT * FROM shopping_list_items WHERE casa_id = ${id} ORDER BY id`,
  };

  // O dump traz dados da casa e o blob cifrado da credencial em JSON claro. Cria o
  // diretorio e o arquivo com permissao restritiva (dono apenas, ~0700/0600) para
  // nao herdar ACL de leitura ampla. Em Windows o modo POSIX e best-effort; ainda
  // assim mantenha o backup fora de compartilhamentos/backups. (auditoria #85)
  const dir = resolve(aqui, "../backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = resolve(dir, `casa-${casa.id}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(dump, null, 2), { encoding: "utf8", mode: 0o600 });

  console.log(`Backup de #${casa.id} "${limpar(casa.name)}" salvo em:`);
  console.log(`  ${file}`);
  console.log("  AVISO: contem dados da casa e o blob da credencial em texto claro.");
  console.log("  Guarde fora de backups/compartilhamentos e apague quando nao precisar mais.");
  console.log(
    `  produtos=${dump.products.length} compras=${dump.purchase_history.length} ` +
      `precos=${dump.price_history.length} itens_lista=${dump.shopping_list_items.length}`,
  );
}

async function del(ref) {
  const casa = await resolverCasa(ref);
  if (!casa) return console.error(`Casa "${limpar(ref)}" nao encontrada.`);
  const n = await contadores(casa.id);
  console.log(`Casa #${casa.id} "${limpar(casa.name)}" code=${token(decifrarCodigo(casa.invite_code_enc))}`);
  console.log(`  Sera apagado (cascade): ${JSON.stringify(n)}`);

  if (!confirmado) {
    console.log("\nDRY-RUN. Para apagar de verdade, repita com --yes:");
    console.log(`  node scripts/casas.mjs delete ${casa.id} --yes`);
    return;
  }

  // purchase_history primeiro (FK NO ACTION); depois a casa (resto por cascade).
  await sql.transaction([
    sql`DELETE FROM purchase_history WHERE casa_id = ${casa.id}`,
    sql`DELETE FROM casas WHERE id = ${casa.id}`,
  ]);
  console.log(`\nCasa #${casa.id} apagada.`);
}

const comandos = {
  list,
  show: () => show(arg),
  export: () => exportar(arg),
  delete: () => del(arg),
};
const acao = comandos[cmd];
if (!acao) {
  console.log("Comandos: list | show <code|id> | export <code|id> | delete <code|id> [--yes]");
  process.exit(cmd ? 1 : 0);
}
await acao();
