import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseDatabaseUrl } from "../env-schema.mjs";
import { productNameKey } from "@repona/core";

const sql = neon(parseDatabaseUrl(process.env.DATABASE_URL));

const args = process.argv.slice(2);
const backupPathArg = args.find((a) => !a.startsWith("--")) || "backups/neon-backup-2026-07-07-22-18-18.json";
const houseRefArg = args.find((a, i) => i > 0 && !a.startsWith("--") && a !== backupPathArg);
const applyConfirmed = args.includes("--yes");

console.log("=== RESTAURAÇÃO DE BACKUP REPONA ===");
console.log(`Arquivo: ${backupPathArg}`);

let backupData;
try {
  const fullPath = resolve(process.cwd(), backupPathArg);
  backupData = JSON.parse(readFileSync(fullPath, "utf8"));
} catch (err) {
  console.error(`Erro ao ler o arquivo de backup: ${err.message}`);
  process.exit(1);
}

const backupProducts = backupData.tabelas?.products || [];
const backupPurchases = backupData.tabelas?.purchase_history || [];
const backupPrices = backupData.tabelas?.price_history || [];
const backupInventory = backupData.tabelas?.inventory_items || [];
const backupShopping = backupData.tabelas?.shopping_list_items || [];
const backupLists = backupData.tabelas?.shopping_lists || [];

console.log(`Exportado em: ${backupData.exportadoEm}`);
console.log(`Registros encontrados:`);
console.log(`  - Produtos: ${backupProducts.length}`);
console.log(`  - Histórico de Compras: ${backupPurchases.length}`);
console.log(`  - Histórico de Preços: ${backupPrices.length}`);
console.log(`  - Itens de Estoque: ${backupInventory.length}`);
console.log(`  - Itens da Lista: ${backupShopping.length}`);

// Descobre a casa alvo
let targetHouseId = null;
if (houseRefArg) {
  const parsedId = parseInt(houseRefArg, 10);
  if (!isNaN(parsedId)) {
    targetHouseId = parsedId;
  }
}

if (!targetHouseId) {
  // Pega a casa mais recente no banco se nenhuma for especificada
  const casas = await sql`SELECT id, name, created_at FROM casas ORDER BY id DESC LIMIT 5`;
  if (casas.length === 0) {
    console.error("Nenhuma casa encontrada no banco para restaurar.");
    process.exit(1);
  }
  console.log("\nCasas disponíveis no banco:");
  for (const c of casas) {
    console.log(`  - ID #${c.id} "${c.name}" (criada em ${new Date(c.created_at).toLocaleString("pt-BR")})`);
  }
  targetHouseId = casas[0].id;
  console.log(`\nUsando casa padrão ID #${targetHouseId} (use 'node scripts/restore-backup.mjs <backup.json> <house_id>' para especificar).`);
}

const casaExistente = await sql`SELECT id, name FROM casas WHERE id = ${targetHouseId}`;
if (casaExistente.length === 0) {
  console.error(`Casa ID #${targetHouseId} não encontrada no banco.`);
  process.exit(1);
}
console.log(`\nRestaurando para a casa ID #${targetHouseId} ("${casaExistente[0].name}")`);

if (!applyConfirmed) {
  console.log("\n--- MODO SIMULAÇÃO (DRY-RUN) ---");
  console.log("Produtos que serão restaurados:");
  for (const p of backupProducts) {
    const pr = backupPrices.find((x) => x.product_id === p.id);
    const precoStr = pr ? `(R$ ${(pr.price_cents / 100).toFixed(2)})` : "";
    console.log(`  - [${p.category || "Mercearia"}] ${p.name} ${p.brand ? `(${p.brand})` : ""} ${precoStr}`);
  }
  console.log("\nPara aplicar as alterações no banco de dados, execute:");
  console.log(`node scripts/restore-backup.mjs "${backupPathArg}" ${targetHouseId} --yes\n`);
  process.exit(0);
}

console.log("\nAplicando restauração no banco de dados...");

// Garante que exista uma lista de compras ativa para a casa
let activeList = await sql`SELECT id FROM shopping_lists WHERE casa_id = ${targetHouseId} AND status = 'active' LIMIT 1`;
let activeListId = activeList[0]?.id;
if (!activeListId) {
  const newList = await sql`INSERT INTO shopping_lists (name, status, casa_id) VALUES ('Lista de Compras', 'active', ${targetHouseId}) RETURNING id`;
  activeListId = newList[0].id;
}

// Mapeamento de ID antigo do produto -> ID novo do produto inserido
const productIdMap = new Map();

for (const p of backupProducts) {
  // Verifica se o produto já existe pelo nome na mesma casa
  const existente = await sql`SELECT id FROM products WHERE casa_id = ${targetHouseId} AND name = ${p.name} LIMIT 1`;
  if (existente.length > 0) {
    productIdMap.set(p.id, existente[0].id);
  } else {
    const nameKey = p.name_key || productNameKey(p.name);
    const inserido = await sql`
      INSERT INTO products (name, name_key, category, brand, photo_uri, casa_id, sync_id, created_at, updated_at)
      VALUES (${p.name}, ${nameKey}, ${p.category || 'Mercearia'}, ${p.brand || null}, ${p.photo_uri || null}, ${targetHouseId}, ${p.sync_id || null}, ${p.created_at || new Date().toISOString()}, ${p.updated_at || new Date().toISOString()})
      RETURNING id
    `;
    productIdMap.set(p.id, inserido[0].id);
  }
}

// Restaura Histórico de Preços
for (const pr of backupPrices) {
  const newProdId = productIdMap.get(pr.product_id);
  if (newProdId) {
    await sql`
      INSERT INTO price_history (product_id, price_cents, recorded_at)
      VALUES (${newProdId}, ${pr.price_cents}, ${pr.recorded_at || new Date().toISOString()})
    `;
  }
}

// Restaura Histórico de Compras
for (const ph of backupPurchases) {
  const newProdId = productIdMap.get(ph.product_id);
  if (newProdId) {
    await sql`
      INSERT INTO purchase_history (product_id, quantity, purchased_at, source_list_id, casa_id, source_list_name, deleted, sync_id, updated_at)
      VALUES (${newProdId}, ${ph.quantity || '1 un'}, ${ph.purchased_at || new Date().toISOString()}, ${activeListId}, ${targetHouseId}, ${ph.source_list_name || 'Lista de Compras'}, ${ph.deleted || false}, ${ph.sync_id || null}, ${ph.updated_at || new Date().toISOString()})
    `;
  }
}

// Restaura Itens de Estoque
for (const inv of backupInventory) {
  const newProdId = productIdMap.get(inv.product_id);
  if (newProdId) {
    await sql`
      INSERT INTO inventory_items (product_id, quantity, status, created_at, updated_at)
      VALUES (${newProdId}, ${inv.quantity || '1 un'}, ${inv.status || 'in_stock'}, ${inv.created_at || new Date().toISOString()}, ${inv.updated_at || new Date().toISOString()})
      ON CONFLICT (product_id) DO UPDATE SET quantity = EXCLUDED.quantity, status = EXCLUDED.status, updated_at = EXCLUDED.updated_at
    `;
  }
}

// Restaura Itens da Lista de Compras
for (const item of backupShopping) {
  const newProdId = productIdMap.get(item.product_id);
  if (newProdId) {
    await sql`
      INSERT INTO shopping_list_items (shopping_list_id, product_id, quantity, checked, created_at, updated_at, casa_id, deleted)
      VALUES (${activeListId}, ${newProdId}, ${item.quantity || '1 un'}, ${item.checked || false}, ${item.created_at || new Date().toISOString()}, ${item.updated_at || new Date().toISOString()}, ${targetHouseId}, ${item.deleted || false})
    `;
  }
}

console.log("\n✅ Restauração concluída com sucesso!");
console.log(`Foram restaurados ${productIdMap.size} produtos e suas respectivas compras, preços e estoque na Casa #${targetHouseId}.`);
