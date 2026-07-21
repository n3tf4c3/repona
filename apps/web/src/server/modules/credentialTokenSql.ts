export const CREATE_ACCOUNT_WITH_RECEIPT_SQL = `with created as (
  insert into casas (name, invite_code_enc)
  select $1, $2
  where not exists (
    select 1 from casa_token_migration_aliases where token_enc = $2
  )
  returning id
), receipt as (
  insert into account_operations
    (operation_id, operation_version, operation_type, request_hash, result_token_enc,
     operation_verifier_hash)
  select $3::uuid, 2, 'create', $4, $2, $5 from created
  returning operation_id
)
select created.id from created cross join receipt`;

export const ROTATE_ACCOUNT_TOKEN_SQL = `with targets as materialized (
  select c.id, c.invite_code_enc,
         (c.invite_code_enc = $1) as is_current
    from casas c
    left join casa_token_migration_aliases a on a.casa_id = c.id
   where c.invite_code_enc = $1
      or ($6 = 'migrate' and a.token_enc = $1 and a.valid_until > $7::timestamptz)
   for update of c
), target as (
  select * from targets where (select count(*) from targets) = 1
), candidate_available as (
  select 1
   where not exists (select 1 from casas where invite_code_enc = $2)
     and not exists (
       select 1 from casa_token_migration_aliases where token_enc = $2
     )
), eligible_target as (
  select t.* from target t
   where not t.is_current or exists (select 1 from candidate_available)
), updated as (
  update casas c
     set invite_code_enc = case when t.is_current then $2 else c.invite_code_enc end,
         credential_version = c.credential_version + case when t.is_current then 1 else 0 end
    from eligible_target t
   where c.id = t.id
   returning c.id as casa_id, c.invite_code_enc,
             c.credential_version, t.is_current
), deleted_alias as (
  delete from casa_token_migration_aliases a
   using updated u
   where a.casa_id = u.casa_id and u.is_current
   returning a.casa_id
), inserted_alias as (
  insert into casa_token_migration_aliases (token_enc, casa_id, valid_until)
  select $1, casa_id, $5::timestamptz from updated
   where $6 = 'migrate' and is_current
     and (select count(*) from deleted_alias) >= 0
  returning casa_id
), result as (
  select updated.*,
         (select count(*) from inserted_alias) as inserted_alias_count
    from updated
), receipt as (
  insert into account_operations
    (operation_id, operation_version, operation_type, request_hash, result_token_enc,
     operation_verifier_hash)
  select $3::uuid, 2, 'rotate', $4, result.invite_code_enc, $8 from result
  returning operation_id
)
select result.casa_id, result.credential_version
  from result cross join receipt`;

export const DELETE_ACCOUNT_WITH_RECEIPT_SQL = `with target as materialized (
  select c.id
    from casas c
   where c.invite_code_enc = $1
   for update of c
), locked_target as materialized (
  select target.id,
         pg_advisory_xact_lock($4::int, target.id::int) as casa_lock
    from target
), deleted_history as (
  delete from purchase_history history
   using locked_target
   where history.casa_id = locked_target.id
  returning history.casa_id
), deleted_casa as (
  delete from casas casa
   using locked_target
   where casa.id = locked_target.id
     and (select count(*) from deleted_history) >= 0
  returning casa.id
), receipt as (
  insert into account_operations
    (operation_id, operation_version, operation_type, request_hash)
  select $2::uuid, 2, 'delete', $3 from deleted_casa
  returning operation_id
)
select deleted_casa.id, receipt.operation_id
  from deleted_casa cross join receipt`;
