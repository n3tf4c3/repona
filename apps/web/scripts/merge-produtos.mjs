// Mescla dois produtos de uma casa sem perder estado. O duplicado (B) tem sua
// identidade aposentada em product_sync_aliases e todo estado passa ao canônico
// (A). O mesmo lock do endpoint /api/sync impede corrida com devices.
//
// Uso (da pasta apps/web):
//   node scripts/merge-produtos.mjs <casa> <dup:id|nome> <canonico:id|nome>
//   node scripts/merge-produtos.mjs <casa> <dup:id|nome> <canonico:id|nome> --yes
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { neon } from "@neondatabase/serverless";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDatabaseUrl } from "../env-schema.mjs";
import { cifrarCodigo, decifrarCodigo } from "./inviteToken.mjs";
import { construirPlanoMerge } from "./mergeProdutosPlan.mjs";
import { casaMutationLockStatement } from "../casa-mutation-lock.mjs";
import {
  construirExpectativaMerge,
  mergeConcurrencyGuardStatement,
} from "./mergeProdutosConcurrency.mjs";

const aqui = dirname(fileURLToPath(import.meta.url));
const sql = neon(parseDatabaseUrl(process.env.DATABASE_URL));
const LOCK_TTL_SECONDS = 15 * 60;

function limpar(valor) {
  return String(valor ?? "").replace(/./gsu, (ch) => {
    const c = ch.codePointAt(0);
    const controle = c <= 0x1f || (c >= 0x7f && c <= 0x9f);
    const bidi = (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069);
    return controle || bidi ? "\uFFFD" : ch;
  });
}

function tokenMascarado(code, revelar) {
  if (revelar) return code;
  return code.length <= 4 ? "****" : `${code.slice(0, 2)}****${code.slice(-2)}`;
}

async function resolverCasa(ref) {
  const porId = /^\d+$/.test(ref)
    ? await sql`SELECT id, name, invite_code_enc FROM casas WHERE id = ${Number(ref)}`
    : [];
  if (porId.length) return porId[0];
  const code = cifrarCodigo(ref.trim().toUpperCase());
  const porCode = await sql`
    SELECT id, name, invite_code_enc FROM casas WHERE invite_code_enc = ${code}
  `;
  return porCode[0] ?? null;
}

async function resolverProduto(casaId, ref) {
  if (/^\d+$/.test(ref)) {
    const rows = await sql`
      SELECT id, casa_id, sync_id, name, archived, barcode, updated_at
      FROM products WHERE casa_id = ${casaId} AND id = ${Number(ref)}
    `;
    return rows[0] ?? null;
  }
  const rows = await sql`
    SELECT id, casa_id, sync_id, name, archived, barcode, updated_at
    FROM products
    WHERE casa_id = ${casaId}
      AND lower(normalize(btrim(name), NFC)) = lower(normalize(btrim(${ref.trim()}::text), NFC))
  `;
  if (rows.length > 1) {
    throw new Error(`Nome "${limpar(ref)}" casa com ${rows.length} produtos; use o id.`);
  }
  return rows[0] ?? null;
}

async function adquirirLock(casaId) {
  const chave = `sync:lock:${casaId}`;
  const lockToken = crypto.randomUUID();
  const expiraEm = new Date(Date.now() + LOCK_TTL_SECONDS * 1000);
  const rows = await sql`
    INSERT INTO sync_locks (chave, token, expira_em)
    VALUES (${chave}, ${lockToken}, ${expiraEm})
    ON CONFLICT (chave) DO UPDATE
      SET token = EXCLUDED.token, expira_em = EXCLUDED.expira_em
      WHERE sync_locks.expira_em <= now()
    RETURNING token
  `;
  return rows.length ? { chave, token: lockToken } : null;
}

async function renovarLock(lock) {
  const expiraEm = new Date(Date.now() + LOCK_TTL_SECONDS * 1000);
  const rows = await sql`
    UPDATE sync_locks SET expira_em = ${expiraEm}
    WHERE chave = ${lock.chave} AND token = ${lock.token} AND expira_em > now()
    RETURNING token
  `;
  if (!rows.length) throw new Error("O lock do merge expirou; nada foi aplicado. Rode novamente.");
}

async function liberarLock(lock) {
  await sql`
    DELETE FROM sync_locks WHERE chave = ${lock.chave} AND token = ${lock.token}
  `;
}

async function carregarEstado(casaId, canonicalId, duplicateId) {
  const ids = [canonicalId, duplicateId];
  const [products, purchases, prices, inventoryEvents, inventoryItems, listItems, aliases] =
    await Promise.all([
      sql`SELECT * FROM products WHERE casa_id = ${casaId} AND id = ANY(${ids}) ORDER BY id`,
      sql`SELECT * FROM purchase_history WHERE product_id = ANY(${ids}) ORDER BY id`,
      sql`SELECT * FROM price_history WHERE product_id = ANY(${ids}) ORDER BY id`,
      sql`SELECT * FROM inventory_events WHERE product_id = ANY(${ids}) ORDER BY id`,
      sql`SELECT * FROM inventory_items WHERE product_id = ANY(${ids}) ORDER BY id`,
      sql`SELECT sli.*, sl.name AS list_name, sl.status AS list_status
          FROM shopping_list_items sli
          INNER JOIN shopping_lists sl ON sl.id = sli.shopping_list_id
          WHERE sli.product_id = ANY(${ids})
          ORDER BY sli.shopping_list_id, sli.id`,
      sql`SELECT * FROM product_sync_aliases
          WHERE casa_id = ${casaId} AND canonical_product_id = ANY(${ids})
          ORDER BY id`,
    ]);
  return { products, purchases, prices, inventoryEvents, inventoryItems, listItems, aliases };
}

function criarPlano(canonical, duplicate, state) {
  const plan = construirPlanoMerge({
    canonical,
    duplicate,
    purchases: state.purchases,
    prices: state.prices,
    inventoryEvents: state.inventoryEvents,
    inventoryItems: state.inventoryItems,
    listItems: state.listItems,
    aliasesPointingToDuplicate: state.aliases.filter(
      (alias) => alias.canonical_product_id === duplicate.id
    ).length,
  });
  plan.inventory.reconciliationSyncId = plan.inventory.emitsSetEvent
    ? crypto.randomUUID()
    : null;
  return plan;
}

function mostrarResumoEventos(rotulo, summary) {
  console.log(
    `  ${rotulo}: preserva ${summary.preserved} ` +
      `(A=${summary.canonical}, B=${summary.duplicate}); ` +
      `${summary.legacyIdsToAssign} legado(s) recebem UUID; ` +
      `${summary.stableIdReplays} replay(s) pelo mesmo UUID`
  );
}

function imprimirPlano(casa, plan, revelarToken) {
  const code = tokenMascarado(decifrarCodigo(casa.invite_code_enc), revelarToken);
  console.log(`Casa #${casa.id} "${limpar(casa.name)}" code=${code}`);
  console.log(
    `  DUPLICADO (some): #${plan.duplicate.id} "${limpar(plan.duplicate.name)}" ` +
      `sync_id=${plan.duplicate.sync_id}${plan.duplicate.archived ? " [ARQ]" : ""}`
  );
  console.log(
    `  CANONICO (fica):  #${plan.canonical.id} "${limpar(plan.canonical.name)}" ` +
      `sync_id=${plan.canonical.sync_id}${plan.canonical.archived ? " [ARQ]" : ""}`
  );
  console.log("\nPlano completo:");
  console.log(
    `  identidade: cria alias ${plan.duplicate.sync_id} -> #${plan.canonical.id}; ` +
      `reaponta ${plan.aliases.repoint} alias(es) anterior(es); metadados do canônico vencem`
  );
  mostrarResumoEventos("compras", plan.purchases);
  console.log(
    `    vivas=${plan.purchases.live}, tombstones=${plan.purchases.tombstones}, ` +
      `purchase_count final=${plan.purchases.finalPurchaseCount}`
  );
  mostrarResumoEventos("precos", plan.prices);
  mostrarResumoEventos("eventos de estoque", plan.inventoryEvents);

  if (plan.inventory.action === "none") {
    console.log("  estoque atual: nenhum registro; nenhum saldo sintético será criado");
  } else {
    const result = plan.inventory.result;
    console.log(
      `  estoque atual: ${plan.inventory.action}; vence ${plan.inventory.winnerSource}; ` +
        `saldo="${limpar(result.quantity)}" status=${limpar(result.status)}; ` +
        `cria evento set ${plan.inventory.reconciliationSyncId}`
    );
  }

  console.log(
    `  itens de lista: ${plan.listItems.rows} linha(s), ${plan.listItems.moves} move(s), ` +
      `${plan.listItems.collisions} colisao(oes) LWW`
  );
  for (const decision of plan.listItems.decisions) {
    const result = decision.result;
    console.log(
      `    lista #${decision.listId} "${limpar(decision.listName)}" [${decision.listStatus}]: ` +
        `${decision.action}, vence=${decision.winnerSource}, ` +
        `quantidade="${limpar(result.quantity)}", checked=${result.checked}, deleted=${result.deleted}`
    );
  }
  console.log(`  final: apaga somente products #${plan.duplicate.id}; todo vínculo já estará reconciliado`);
  console.log("  dedupe: somente sync_id idêntico representa replay; conteúdo coincidente é preservado");
}

function salvarBackup(casa, plan, state) {
  const dump = {
    exportadoEm: new Date().toISOString(),
    casa,
    plano: plan,
    products: state.products,
    purchase_history: state.purchases,
    price_history: state.prices,
    inventory_events: state.inventoryEvents,
    inventory_items: state.inventoryItems,
    shopping_list_items: state.listItems,
    product_sync_aliases: state.aliases,
  };
  const dir = resolve(aqui, "../backups");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = resolve(
    dir,
    `merge-${casa.id}-${plan.duplicate.id}-into-${plan.canonical.id}-${stamp}.json`
  );
  writeFileSync(file, JSON.stringify(dump, null, 2), { encoding: "utf8", mode: 0o600 });
  console.log(`\nBackup salvo em:\n  ${file}`);
  console.log("  AVISO: contem dados da casa em texto claro.");
  console.log("  Guarde fora de compartilhamentos/backups e apague quando nao precisar mais.");
}

async function aplicarMerge(casaId, plan, expectation) {
  const canonicalId = plan.canonical.id;
  const duplicateId = plan.duplicate.id;
  const productIds = [canonicalId, duplicateId];
  const statements = [
    // Mesmo mutex transacional dos mutators web e do sync paginado. Precisa ser
    // o primeiro statement para nenhum read/write do merge correr em paralelo.
    casaMutationLockStatement(sql, casaId),
    // O plano foi calculado antes da transacao para permitir dry-run/confirmacao.
    // Revalida sob o mutex; qualquer edicao desde o backup aborta tudo.
    mergeConcurrencyGuardStatement(sql, casaId, expectation),
    // Trava ambos os produtos durante a transação, além do lock distribuído do sync.
    sql`SELECT id FROM products
        WHERE casa_id = ${casaId} AND id = ANY(${productIds})
        ORDER BY id FOR UPDATE`,

    // Eventos legados ganham identidade antes de mudar de produto. Nunca usamos
    // timestamp/quantidade para dedupe: eventos simultâneos legítimos sobrevivem.
    sql`UPDATE purchase_history SET sync_id = gen_random_uuid()
        WHERE product_id = ANY(${productIds}) AND sync_id IS NULL`,
    sql`UPDATE price_history SET sync_id = gen_random_uuid()
        WHERE product_id = ANY(${productIds}) AND sync_id IS NULL`,
    sql`UPDATE inventory_events SET sync_id = gen_random_uuid()
        WHERE product_id = ANY(${productIds}) AND sync_id IS NULL`,
    sql`UPDATE purchase_history SET product_id = ${canonicalId}
        WHERE product_id = ${duplicateId}`,
    sql`UPDATE price_history SET product_id = ${canonicalId}
        WHERE product_id = ${duplicateId}`,
    sql`UPDATE inventory_events SET product_id = ${canonicalId}
        WHERE product_id = ${duplicateId}`,

    // Em cada lista, se A e B coexistem, aplica LWW. Tombstone vence empate de
    // relógio para não ressuscitar item removido; A vence os demais empates.
    sql`WITH choices AS (
          SELECT
            a.id AS target_id,
            CASE
              WHEN b.updated_at > a.updated_at
                OR (b.updated_at = a.updated_at AND b.deleted AND NOT a.deleted)
              THEN b.quantity ELSE a.quantity
            END AS quantity,
            CASE
              WHEN b.updated_at > a.updated_at
                OR (b.updated_at = a.updated_at AND b.deleted AND NOT a.deleted)
              THEN b.checked ELSE a.checked
            END AS checked,
            CASE
              WHEN b.updated_at > a.updated_at
                OR (b.updated_at = a.updated_at AND b.deleted AND NOT a.deleted)
              THEN b.deleted ELSE a.deleted
            END AS deleted,
            LEAST(a.created_at, b.created_at) AS created_at,
            GREATEST(a.updated_at, b.updated_at) AS updated_at
          FROM shopping_list_items a
          INNER JOIN shopping_list_items b
            ON b.shopping_list_id = a.shopping_list_id
           AND b.product_id = ${duplicateId}
          WHERE a.product_id = ${canonicalId}
        )
        UPDATE shopping_list_items target SET
          quantity = choices.quantity,
          checked = choices.checked,
          deleted = choices.deleted,
          created_at = choices.created_at,
          updated_at = choices.updated_at
        FROM choices WHERE target.id = choices.target_id`,
    sql`DELETE FROM shopping_list_items b
        WHERE b.product_id = ${duplicateId}
          AND EXISTS (
            SELECT 1 FROM shopping_list_items a
            WHERE a.shopping_list_id = b.shopping_list_id
              AND a.product_id = ${canonicalId}
          )`,
    sql`UPDATE shopping_list_items SET product_id = ${canonicalId}
        WHERE product_id = ${duplicateId}`,

    // O saldo mais recente vence (A em empate), mas ambos os fluxos de eventos
    // foram preservados acima. Um novo set torna a decisão explícita/convergente.
    sql`UPDATE inventory_items a SET
          quantity = CASE WHEN b.updated_at > a.updated_at THEN b.quantity ELSE a.quantity END,
          status = CASE WHEN b.updated_at > a.updated_at THEN b.status ELSE a.status END,
          created_at = LEAST(a.created_at, b.created_at),
          updated_at = GREATEST(a.updated_at, b.updated_at)
        FROM inventory_items b
        WHERE a.product_id = ${canonicalId} AND b.product_id = ${duplicateId}`,
    sql`DELETE FROM inventory_items b
        WHERE b.product_id = ${duplicateId}
          AND EXISTS (SELECT 1 FROM inventory_items a WHERE a.product_id = ${canonicalId})`,
    sql`UPDATE inventory_items SET product_id = ${canonicalId}
        WHERE product_id = ${duplicateId}`,
  ];

  if (plan.inventory.reconciliationSyncId) {
    statements.push(sql`WITH event_state AS (
          SELECT
            ii.product_id,
            ii.quantity,
            GREATEST(
              now(),
              ii.updated_at + interval '1 millisecond',
              COALESCE(
                (SELECT MAX(ie.occurred_at) + interval '1 millisecond'
                 FROM inventory_events ie WHERE ie.product_id = ii.product_id),
                now()
              )
            ) AS occurred_at
          FROM inventory_items ii WHERE ii.product_id = ${canonicalId}
        ), inserted AS (
          INSERT INTO inventory_events (sync_id, product_id, event_type, quantity, occurred_at)
          SELECT ${plan.inventory.reconciliationSyncId}, product_id, 'set', quantity, occurred_at
          FROM event_state
          RETURNING product_id, occurred_at
        )
        UPDATE inventory_items ii SET updated_at = inserted.occurred_at
        FROM inserted WHERE ii.product_id = inserted.product_id`);
  }

  statements.push(
    // Cadeias de aliases também convergem quando o canônico de um merge antigo
    // vira duplicado neste merge.
    sql`UPDATE product_sync_aliases SET canonical_product_id = ${canonicalId}
        WHERE casa_id = ${casaId} AND canonical_product_id = ${duplicateId}`,
    sql`INSERT INTO product_sync_aliases (casa_id, old_sync_id, canonical_product_id)
        VALUES (${casaId}, ${plan.duplicate.sync_id}, ${canonicalId})
        ON CONFLICT (casa_id, old_sync_id) DO UPDATE
        SET canonical_product_id = EXCLUDED.canonical_product_id`,
    sql`DELETE FROM products
        WHERE casa_id = ${casaId} AND id = ${duplicateId}`,
    sql`UPDATE products p SET
          purchase_count = (
            SELECT count(*)::int FROM purchase_history ph
            WHERE ph.product_id = p.id AND ph.deleted = false
          ),
          status = COALESCE(
            (SELECT CASE WHEN ii.status = 'missing' THEN 'missing' ELSE 'active' END
             FROM inventory_items ii WHERE ii.product_id = p.id),
            p.status
          )
        WHERE p.casa_id = ${casaId} AND p.id = ${canonicalId}`
  );

  await sql.transaction(statements);
  const duplicateStillExists = await sql`
    SELECT id FROM products WHERE casa_id = ${casaId} AND id = ${duplicateId}
  `;
  if (duplicateStillExists.length) throw new Error("Merge não removeu o produto duplicado.");
}

async function contarFinal(productId) {
  const [row] = await sql`SELECT
    (SELECT count(*)::int FROM purchase_history
      WHERE product_id = ${productId} AND deleted = false) AS compras_vivas,
    (SELECT count(*)::int FROM purchase_history
      WHERE product_id = ${productId} AND deleted = true) AS tombstones_compra,
    (SELECT count(*)::int FROM price_history WHERE product_id = ${productId}) AS precos,
    (SELECT count(*)::int FROM inventory_events WHERE product_id = ${productId}) AS eventos_estoque,
    (SELECT count(*)::int FROM shopping_list_items WHERE product_id = ${productId}) AS itens_lista,
    (SELECT count(*)::int FROM product_sync_aliases
      WHERE canonical_product_id = ${productId}) AS aliases`;
  return row;
}

async function main() {
  const [casaRef, duplicateRef, canonicalRef, ...flags] = process.argv.slice(2);
  const confirmado = flags.includes("--yes");
  const revelarToken = flags.includes("--show-token");
  if (!casaRef || !duplicateRef || !canonicalRef) {
    console.log(
      "Uso: node scripts/merge-produtos.mjs <casa> <dup:id|nome> <canonico:id|nome> [--yes]"
    );
    return;
  }

  const casa = await resolverCasa(casaRef);
  if (!casa) throw new Error("Casa não encontrada.");
  const lock = await adquirirLock(casa.id);
  if (!lock) {
    throw new Error("A casa está sincronizando ou em outro merge. Tente novamente em instantes.");
  }

  try {
    const duplicate = await resolverProduto(casa.id, duplicateRef);
    const canonical = await resolverProduto(casa.id, canonicalRef);
    if (!duplicate) throw new Error(`Duplicado "${limpar(duplicateRef)}" não encontrado na casa.`);
    if (!canonical) throw new Error(`Canônico "${limpar(canonicalRef)}" não encontrado na casa.`);
    if (canonical.id === duplicate.id) throw new Error("Duplicado e canônico são o mesmo produto.");

    const state = await carregarEstado(casa.id, canonical.id, duplicate.id);
    const plan = criarPlano(canonical, duplicate, state);
    const mergeExpectation = construirExpectativaMerge(state);
    imprimirPlano(casa, plan, revelarToken);

    if (!confirmado) {
      console.log("\nDRY-RUN. Nada foi alterado. Para aplicar (com backup antes):");
      console.log(
        `  node scripts/merge-produtos.mjs ${casa.id} ${duplicate.id} ${canonical.id} --yes`
      );
      return;
    }

    salvarBackup(casa, plan, state);
    await renovarLock(lock);
    await aplicarMerge(casa.id, plan, mergeExpectation);
    const final = await contarFinal(canonical.id);
    console.log(`\nMerge concluído. #${canonical.id} "${limpar(canonical.name)}":`);
    console.log(`  ${JSON.stringify(final)}`);
    console.log(
      `#${duplicate.id} "${limpar(duplicate.name)}" foi aposentado; ` +
        `sync_id ${duplicate.sync_id} agora resolve para o canônico.`
    );
  } finally {
    try {
      await liberarLock(lock);
    } catch (error) {
      // O token torna o lock autoexpirável e impede remover o lock de outro
      // processo. Falha de cleanup não muda o resultado já commitado do merge.
      console.error(
        `AVISO: não foi possível liberar o lock agora; ele expira em até ${LOCK_TTL_SECONDS}s ` +
          `(${limpar(error instanceof Error ? error.message : error)}).`
      );
    }
  }
}

try {
  await main();
} catch (error) {
  console.error(`ERRO: ${limpar(error instanceof Error ? error.message : error)}`);
  process.exitCode = 1;
}
