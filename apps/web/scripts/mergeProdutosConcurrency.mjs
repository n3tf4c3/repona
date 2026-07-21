const VIOLATION_MARKER = "merge_concurrent_mutation:";
const OK_UUID = "00000000-0000-4000-8000-000000000000";

function iso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function construirExpectativaMerge(state) {
  return {
    products: state.products.map((row) => ({
      id: Number(row.id),
      syncId: row.sync_id,
      name: row.name,
      category: row.category,
      brand: row.brand ?? null,
      barcode: row.barcode ?? null,
      photoUri: row.photo_uri ?? null,
      purchaseCount: Number(row.purchase_count),
      status: row.status,
      alertThreshold: row.alert_threshold ?? null,
      archived: Boolean(row.archived),
      occasional: Boolean(row.occasional),
      updatedAt: iso(row.updated_at),
    })),
    inventories: state.inventoryItems.map((row) => ({
      productId: Number(row.product_id),
      quantity: row.quantity,
      status: row.status,
      updatedAt: iso(row.updated_at),
    })),
    listItems: state.listItems.map((row) => ({
      id: Number(row.id),
      productId: Number(row.product_id),
      quantity: row.quantity,
      checked: Boolean(row.checked),
      deleted: Boolean(row.deleted),
      updatedAt: iso(row.updated_at),
    })),
  };
}

// Tag generica: funciona com `neon` no CLI e com uma tag parametrizada simples
// no teste PostgreSQL. O advisory deve ser o statement imediatamente anterior
// na mesma transacao; este guard revalida todos os dados usados pelo plano.
export function mergeConcurrencyGuardStatement(sql, casaId, expectation) {
  const productsJson = JSON.stringify(expectation.products);
  const inventoriesJson = JSON.stringify(expectation.inventories);
  const listItemsJson = JSON.stringify(expectation.listItems);
  return sql`
    with expected_products as materialized (
      select * from jsonb_to_recordset(${productsJson}::jsonb) as expected(
        id integer,
        "syncId" uuid,
        name text,
        category text,
        brand text,
        barcode text,
        "photoUri" text,
        "purchaseCount" integer,
        status text,
        "alertThreshold" text,
        archived boolean,
        occasional boolean,
        "updatedAt" timestamptz
      )
    ),
    locked_products as materialized (
      select
        p.id,
        p.sync_id as "syncId",
        p.name,
        p.category,
        p.brand,
        p.barcode,
        p.photo_uri as "photoUri",
        p.purchase_count as "purchaseCount",
        p.status,
        p.alert_threshold as "alertThreshold",
        p.archived,
        p.occasional,
        date_trunc('milliseconds', p.updated_at) as "updatedAt"
      from products p
      inner join expected_products expected on expected.id = p.id
      where p.casa_id = ${casaId}
      order by p.id
      for update of p
    ),
    expected_inventories as materialized (
      select * from jsonb_to_recordset(${inventoriesJson}::jsonb) as expected(
        "productId" integer, quantity text, status text, "updatedAt" timestamptz
      )
    ),
    locked_inventories as materialized (
      select ii.product_id as "productId", ii.quantity, ii.status,
             date_trunc('milliseconds', ii.updated_at) as "updatedAt"
      from inventory_items ii
      inner join expected_products expected on expected.id = ii.product_id
      order by ii.product_id
      for update of ii
    ),
    expected_list_items as materialized (
      select * from jsonb_to_recordset(${listItemsJson}::jsonb) as expected(
        id integer,
        "productId" integer,
        quantity text,
        checked boolean,
        deleted boolean,
        "updatedAt" timestamptz
      )
    ),
    locked_list_items as materialized (
      select sli.id, sli.product_id as "productId", sli.quantity, sli.checked, sli.deleted,
             date_trunc('milliseconds', sli.updated_at) as "updatedAt"
      from shopping_list_items sli
      inner join expected_products expected on expected.id = sli.product_id
      where sli.casa_id = ${casaId}
      order by sli.id
      for update of sli
    ),
    differences as materialized (
      select 'products'::text as kind
      from expected_products expected
      full join locked_products current on current.id = expected.id
      where current.id is null or expected.id is null
        or current."syncId" is distinct from expected."syncId"
        or current.name is distinct from expected.name
        or current.category is distinct from expected.category
        or current.brand is distinct from expected.brand
        or current.barcode is distinct from expected.barcode
        or current."photoUri" is distinct from expected."photoUri"
        or current."purchaseCount" is distinct from expected."purchaseCount"
        or current.status is distinct from expected.status
        or current."alertThreshold" is distinct from expected."alertThreshold"
        or current.archived is distinct from expected.archived
        or current.occasional is distinct from expected.occasional
        or current."updatedAt" is distinct from expected."updatedAt"

      union all

      select 'inventories'::text as kind
      from expected_inventories expected
      full join locked_inventories current
        on current."productId" = expected."productId"
      where current."productId" is null or expected."productId" is null
        or current.quantity is distinct from expected.quantity
        or current.status is distinct from expected.status
        or current."updatedAt" is distinct from expected."updatedAt"

      union all

      select 'list-items'::text as kind
      from expected_list_items expected
      full join locked_list_items current on current.id = expected.id
      where current.id is null or expected.id is null
        or current."productId" is distinct from expected."productId"
        or current.quantity is distinct from expected.quantity
        or current.checked is distinct from expected.checked
        or current.deleted is distinct from expected.deleted
        or current."updatedAt" is distinct from expected."updatedAt"
    )
    select case
      when not exists (select 1 from differences) then ${OK_UUID}::uuid
      else (
        ${VIOLATION_MARKER} ||
        (select string_agg(distinct kind, ',') from differences) || ':' ||
        ${casaId}::text
      )::uuid
    end as merge_concurrency_guard
  `;
}

export function isMergeConcurrencyViolation(error) {
  let current = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    if (
      current.code === "22P02" &&
      typeof current.message === "string" &&
      current.message.includes(VIOLATION_MARKER)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}
