// Instruções parametrizadas compartilhadas pelo runtime Neon e pelos testes de
// integração em PostgreSQL. Cada mutação inteira é um único statement: o recibo
// idempotente e todos os efeitos commitam ou fazem rollback juntos. (#22/#88)
import { CASA_MUTATION_LOCK_NAMESPACE } from "./casaMutationLock";

export const CONSUME_DOMAIN_OPERATION_SQL = `
  with house_mutex as materialized (
    select pg_advisory_xact_lock(${CASA_MUTATION_LOCK_NAMESPACE}, $2::int)
  ),
  locked_inventory as materialized (
    select
      ii.product_id,
      replace(parsed.parts[1], ',', '.')::numeric as current_value,
      coalesce(nullif(btrim(parsed.parts[2]), ''), 'un') as unit
    from inventory_items ii
    inner join products p on p.id = ii.product_id
    cross join lateral regexp_match(
      ii.quantity,
      '^([0-9]+(?:[.,][0-9]+)?)[[:space:]]*(.*)$'
    ) as parsed(parts)
    where p.casa_id = $2
      and ii.product_id = $3
      and (select count(*) from house_mutex) = 1
      and not exists (
        select 1 from domain_operations where operation_id = $1::uuid
      )
    for update of ii
  ),
  calculated as (
    select
      product_id,
      unit,
      least(current_value, case when unit = 'g' then 100 else 1 end) as consumed_value,
      greatest(0, current_value - case when unit = 'g' then 100 else 1 end) as next_value
    from locked_inventory
    where current_value > 0
  ),
  formatted as (
    select
      product_id,
      case
        when next_value = trunc(next_value) then trunc(next_value)::text
        else replace(to_char(next_value, 'FM999999999990.0'), '.', ',')
      end || ' ' || unit as next_quantity,
      case
        when consumed_value = trunc(consumed_value) then trunc(consumed_value)::text
        else replace(to_char(consumed_value, 'FM999999999990.0'), '.', ',')
      end || ' ' || unit as consumed_quantity
    from calculated
  ),
  updated_inventory as (
    update inventory_items ii
    set
      quantity = f.next_quantity,
      status = case when f.next_quantity ~ '^0(?:[,.]0+)?[[:space:]]' then 'missing' else 'in_stock' end,
      updated_at = now()
    from formatted f
    where ii.product_id = f.product_id
    returning ii.product_id, ii.status, f.consumed_quantity
  ),
  inserted_event as (
    insert into inventory_events
      (sync_id, product_id, event_type, quantity, occurred_at)
    select $1::uuid, product_id, 'consumed', consumed_quantity, now()
    from updated_inventory
    returning product_id
  ),
  updated_product as (
    update products p
    set status = case when ui.status = 'missing' then 'missing' else 'active' end
    from updated_inventory ui
    where p.id = ui.product_id
      and p.casa_id = $2
      and exists (select 1 from inserted_event)
    returning p.id
  ),
  completed as (
    insert into domain_operations
      (operation_id, casa_id, operation_type, resource_id, result_count)
    select $1::uuid, $2, 'consume', $3, count(*)::int
    from inserted_event
    on conflict (operation_id) do nothing
    returning
      operation_type as "operationType",
      casa_id as "casaId",
      resource_id as "resourceId",
      result_count as "resultCount"
  )
  select * from completed
`;

export const FINALIZE_PURCHASE_OPERATION_SQL = `
  with house_mutex as materialized (
    select pg_advisory_xact_lock(${CASA_MUTATION_LOCK_NAMESPACE}, $2::int)
  ),
  request_shape as materialized (
    select $3::int as requested_list_id, $4::text as requested_list_name
  ),
  active_list as materialized (
    select sl.id, sl.name
    from shopping_lists sl
    cross join request_shape
    where sl.casa_id = $2
      and sl.status = 'active'
      and (select count(*) from house_mutex) = 1
    order by sl.created_at desc
    limit 1
  ),
  locked_items as materialized (
    select
      sli.id as item_id,
      sli.product_id,
      sli.quantity,
      parsed.parts
    from shopping_list_items sli
    inner join products p on p.id = sli.product_id
    inner join active_list al on al.id = sli.shopping_list_id
    left join lateral regexp_match(
      sli.quantity,
      '^([0-9]+(?:[.,][0-9]+)?)[[:space:]]*([A-Za-zÀ-ÿ]+)$'
    ) as parsed(parts) on true
    where sli.checked = true
      and sli.deleted = false
      and p.casa_id = $2
      and p.archived = false
      and (select count(*) from house_mutex) = 1
      and not exists (
        select 1 from domain_operations where operation_id = $1::uuid
      )
    for update of sli
  ),
  validation as (
    select coalesce(
      bool_or(parts is null or replace(parts[1], ',', '.')::numeric <= 0),
      false
    ) as invalid
    from locked_items
  ),
  claimed_items as (
    update shopping_list_items sli
    set deleted = true, updated_at = now()
    from locked_items li
    where sli.id = li.item_id
      and not (select invalid from validation)
    returning sli.id, sli.product_id, sli.quantity
  ),
  inserted_purchases as (
    insert into purchase_history
      (sync_id, casa_id, product_id, quantity, purchased_at, source_list_id, source_list_name)
    select
      gen_random_uuid(),
      $2,
      product_id,
      quantity,
      now(),
      (select id from active_list),
      (select name from active_list)
    from claimed_items
    returning product_id
  ),
  updated_inventory as (
    insert into inventory_items
      (product_id, quantity, status, created_at, updated_at)
    select product_id, quantity, 'in_stock', now(), now()
    from claimed_items
    on conflict (product_id) do update
    set
      quantity = excluded.quantity,
      status = 'in_stock',
      updated_at = excluded.updated_at
    returning product_id
  ),
  inserted_inventory_events as (
    insert into inventory_events
      (sync_id, product_id, event_type, quantity, occurred_at)
    select gen_random_uuid(), ci.product_id, 'set', ci.quantity, now()
    from claimed_items ci
    where exists (
      select 1 from updated_inventory ui where ui.product_id = ci.product_id
    )
    returning product_id
  ),
  updated_products as (
    update products p
    set purchase_count = p.purchase_count + 1, status = 'active'
    from inserted_purchases ip
    where p.id = ip.product_id
      and p.casa_id = $2
      and exists (
        select 1 from inserted_inventory_events ie where ie.product_id = ip.product_id
      )
    returning p.id
  ),
  completed as (
    insert into domain_operations
      (operation_id, casa_id, operation_type, resource_id, result_count)
    select
      $1::uuid,
      $2,
      'finalize-purchase',
      (select id from active_list),
      case
        when (select invalid from validation) then -1
        else (select count(*)::int from inserted_purchases)
      end
    on conflict (operation_id) do nothing
    returning
      operation_type as "operationType",
      casa_id as "casaId",
      resource_id as "resourceId",
      result_count as "resultCount"
  )
  select * from completed
`;

export const READ_DOMAIN_OPERATION_SQL = `
  select
    operation_type as "operationType",
    casa_id as "casaId",
    resource_id as "resourceId",
    result_count as "resultCount"
  from domain_operations
  where operation_id = $1::uuid
  limit 1
`;
