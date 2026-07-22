import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });
import { neon } from "@neondatabase/serverless";
import { parseDatabaseUrl } from "../env-schema.mjs";

const sql = neon(parseDatabaseUrl(process.env.DATABASE_URL));
const houseId = 16;

console.log(`=== DEDUPLICAÇÃO DE REGISTROS DA CASA #${houseId} ===`);

// 1. Deduplica purchase_history
const purchases = await sql`
  SELECT id, product_id, quantity, purchased_at
  FROM purchase_history
  WHERE casa_id = ${houseId}
  ORDER BY id ASC
`;

console.log(`Total de registros em purchase_history: ${purchases.length}`);

const seenPurchaseKeys = new Set();
const duplicatePurchaseIds = [];

for (const p of purchases) {
  const key = `${p.product_id}_${p.quantity}_${p.purchased_at}`;
  if (seenPurchaseKeys.has(key)) {
    duplicatePurchaseIds.push(p.id);
  } else {
    seenPurchaseKeys.add(key);
  }
}

console.log(`Duplicados identificados em purchase_history: ${duplicatePurchaseIds.length}`);

if (duplicatePurchaseIds.length > 0) {
  for (const id of duplicatePurchaseIds) {
    await sql`DELETE FROM purchase_history WHERE id = ${id}`;
  }
  console.log(`✅ ${duplicatePurchaseIds.length} compras duplicadas foram removidas de purchase_history.`);
}

// 2. Deduplica price_history
const prices = await sql`
  SELECT ph.id, ph.product_id, ph.price_cents, ph.recorded_at
  FROM price_history ph
  JOIN products p ON ph.product_id = p.id
  WHERE p.casa_id = ${houseId}
  ORDER BY ph.id ASC
`;

console.log(`Total de registros em price_history: ${prices.length}`);

const seenPriceKeys = new Set();
const duplicatePriceIds = [];

for (const pr of prices) {
  const key = `${pr.product_id}_${pr.price_cents}_${pr.recorded_at}`;
  if (seenPriceKeys.has(key)) {
    duplicatePriceIds.push(pr.id);
  } else {
    seenPriceKeys.add(key);
  }
}

console.log(`Duplicados identificados em price_history: ${duplicatePriceIds.length}`);

if (duplicatePriceIds.length > 0) {
  for (const id of duplicatePriceIds) {
    await sql`DELETE FROM price_history WHERE id = ${id}`;
  }
  console.log(`✅ ${duplicatePriceIds.length} preços duplicados foram removidos de price_history.`);
}

// 3. Verifica o total estimado após a deduplicação
const purchasesFinal = await sql`
  SELECT ph.quantity, pr.price_cents
  FROM purchase_history ph
  JOIN price_history pr ON ph.product_id = pr.product_id
  WHERE ph.casa_id = ${houseId} AND ph.deleted = false
`;

let totalCents = 0;
for (const row of purchasesFinal) {
  const qtyNum = parseFloat((row.quantity || "1").replace(/[^0-9.]/g, "")) || 1;
  totalCents += Math.round(qtyNum * row.price_cents);
}

console.log("\n=== STATUS FINAL DA CASA #16 ===");
console.log(`Compras registradas: ${purchasesFinal.length} itens (esperado: 29)`);
console.log(`Valor Total Estimado: R$ ${(totalCents / 100).toFixed(2).replace('.', ',')}`);
