import { sql, type SQL } from "drizzle-orm";

// O merge do sync calcula as escritas em JavaScript porque o driver neon-http
// nao oferece transacao interativa. Estes valores registram exatamente o estado
// usado nesse calculo; o primeiro statement do db.batch os revalida e bloqueia.
// Assim, uma mutacao web entre os reads e o commit faz o batch inteiro abortar,
// enquanto uma mutacao iniciada depois do guard espera os row locks. (#74)
export type SyncConcurrencyExpectation = {
  products: Array<{
    id: number;
    syncId: string;
    name: string;
    category: string;
    brand: string | null;
    barcode: string | null;
    photoUri: string | null;
    purchaseCount: number;
    status: string;
    alertThreshold: string | null;
    archived: boolean;
    occasional: boolean;
    updatedAt: string;
  }>;
  inventories: Array<{
    productId: number;
    quantity: string;
    status: string;
    updatedAt: string;
  }>;
  activeList?: {
    id: number;
    name: string;
    status: string;
    updatedAt: string;
    relevantProductIds: number[];
    items: Array<{
      productId: number;
      quantity: string;
      checked: boolean;
      deleted: boolean;
      updatedAt: string;
    }>;
  };
};

const OK_UUID = "00000000-0000-4000-8000-000000000000";
const VIOLATION_MARKER = "sync_concurrent_mutation:";
const CONCURRENT_UNIQUE_CONSTRAINTS = new Set([
  "products_casa_name_key_unique",
  "products_casa_syncid_unique",
  "products_casa_barcode_unique",
  "inventory_items_product_id_unique",
  "shopping_list_items_unique_product",
  "product_sync_aliases_casa_old_unique",
]);

export class SyncConcurrentMutationError extends Error {
  constructor() {
    super("SYNC_CONCURRENT_MUTATION");
    this.name = "SyncConcurrentMutationError";
  }
}

// O branch invalido converte um marcador dinamico para uuid. Isso produz 22P02
// com uma mensagem inequivoca, em vez de reutilizar o 22012 do fence da lease.
// O predicado abaixo exige codigo + marcador e nao mascara outros erros do batch.
export function isSyncConcurrencyGuardViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (
      record.code === "22P02" &&
      typeof record.message === "string" &&
      record.message.includes(VIOLATION_MARKER)
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export function isSyncConcurrentUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const record = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (
      record.code === "23505" &&
      typeof record.constraint === "string" &&
      CONCURRENT_UNIQUE_CONSTRAINTS.has(record.constraint)
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}

export function buildSyncConcurrencyGuard(
  casaId: number,
  expectation: SyncConcurrencyExpectation
): SQL {
  const productsJson = JSON.stringify(expectation.products);
  const inventoriesJson = JSON.stringify(expectation.inventories);
  const protectList = expectation.activeList !== undefined;
  const listsJson = JSON.stringify(
    expectation.activeList
      ? [
          {
            id: expectation.activeList.id,
            name: expectation.activeList.name,
            status: expectation.activeList.status,
            updatedAt: expectation.activeList.updatedAt,
          },
        ]
      : []
  );
  const listItemsJson = JSON.stringify(expectation.activeList?.items ?? []);
  const relevantListProductsJson = JSON.stringify(
    (expectation.activeList?.relevantProductIds ?? []).map((productId) => ({ productId }))
  );

  return sql`
    with expected_products as materialized (
      select *
      from jsonb_to_recordset(${productsJson}::jsonb) as expected(
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
    expected_inventories as materialized (
      select *
      from jsonb_to_recordset(${inventoriesJson}::jsonb) as expected(
        "productId" integer,
        quantity text,
        status text,
        "updatedAt" timestamptz
      )
    ),
    expected_lists as materialized (
      select *
      from jsonb_to_recordset(${listsJson}::jsonb) as expected(
        id integer,
        name text,
        status text,
        "updatedAt" timestamptz
      )
    ),
    locked_lists as materialized (
      select
        sl.id,
        sl.name,
        sl.status,
        date_trunc('milliseconds', sl.updated_at) as "updatedAt"
      from shopping_lists sl
      where ${protectList}
        and sl.casa_id = ${casaId}
        and sl.status = 'active'
      order by sl.id
      for update of sl
    ),
    expected_list_items as materialized (
      select *
      from jsonb_to_recordset(${listItemsJson}::jsonb) as expected(
        "productId" integer,
        quantity text,
        checked boolean,
        deleted boolean,
        "updatedAt" timestamptz
      )
    ),
    relevant_list_products as materialized (
      select *
      from jsonb_to_recordset(${relevantListProductsJson}::jsonb) as relevant(
        "productId" integer
      )
    ),
    locked_list_items as materialized (
      select
        sli.product_id as "productId",
        sli.quantity,
        sli.checked,
        sli.deleted,
        date_trunc('milliseconds', sli.updated_at) as "updatedAt"
      from shopping_list_items sli
      where ${protectList}
        and sli.shopping_list_id in (select id from locked_lists)
        and sli.product_id in (select "productId" from relevant_list_products)
      order by sli.product_id
      for update of sli
    ),
    locked_inventories as materialized (
      select
        ii.product_id as "productId",
        ii.quantity,
        ii.status,
        date_trunc('milliseconds', ii.updated_at) as "updatedAt"
      from inventory_items ii
      inner join products p on p.id = ii.product_id
      inner join expected_products expected on expected.id = ii.product_id
      cross join (select count(*) as locked_count from locked_list_items) lock_order
      where p.casa_id = ${casaId}
        and lock_order.locked_count >= 0
      order by ii.product_id
      for update of ii
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
      cross join (select count(*) as locked_count from locked_inventories) lock_order
      where p.casa_id = ${casaId}
        and lock_order.locked_count >= 0
      order by p.id
      for update of p
    ),
    differences as materialized (
      select 'products'::text as kind
      from expected_products expected
      full join locked_products current on current.id = expected.id
      where current.id is null
        or expected.id is null
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
      where current."productId" is null
        or expected."productId" is null
        or current.quantity is distinct from expected.quantity
        or current.status is distinct from expected.status
        or current."updatedAt" is distinct from expected."updatedAt"

      union all

      select 'active-list'::text as kind
      from expected_lists expected
      full join locked_lists current on current.id = expected.id
      where current.id is null
        or expected.id is null
        or current.name is distinct from expected.name
        or current.status is distinct from expected.status
        or current."updatedAt" is distinct from expected."updatedAt"

      union all

      select 'list-items'::text as kind
      from expected_list_items expected
      full join locked_list_items current
        on current."productId" = expected."productId"
      where current."productId" is null
        or expected."productId" is null
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
    end as concurrency_guard
  `;
}
