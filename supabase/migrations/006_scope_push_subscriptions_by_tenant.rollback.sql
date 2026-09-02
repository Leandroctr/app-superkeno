-- Rollback for 006_scope_push_subscriptions_by_tenant.sql.
-- It restores the exact previous global UNIQUE constraint only when no
-- subscription ID currently appears in more than one row. Otherwise it aborts
-- transactionally because an exact, lossless rollback is impossible.

begin;

lock table public.push_subscriptions in share row exclusive mode;

do $$
declare
  v_before_count bigint;
  v_after_count bigint;
  v_global_duplicates bigint;
begin
  if to_regclass('public.push_subscriptions') is null then
    raise exception 'Rollback 006 aborted: public.push_subscriptions does not exist.';
  end if;

  select count(*) into v_before_count
  from public.push_subscriptions;

  select count(*) into v_global_duplicates
  from (
    select onesignal_id
    from public.push_subscriptions
    group by onesignal_id
    having count(*) > 1
  ) duplicates;

  if v_global_duplicates > 0 then
    raise exception
      'Rollback 006 aborted: % subscription ID(s) now exist in multiple rows; no data was changed.',
      v_global_duplicates;
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname = 'push_subscriptions'
      and con.conname = 'push_subscriptions_onesignal_id_tenant_domain_key'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid, true) =
        'UNIQUE (onesignal_id, tenant_domain)'
  ) then
    alter table public.push_subscriptions
      drop constraint push_subscriptions_onesignal_id_tenant_domain_key;
  elsif exists (
    select 1
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname = 'push_subscriptions'
      and con.conname = 'push_subscriptions_onesignal_id_tenant_domain_key'
  ) then
    raise exception
      'Rollback 006 aborted: composite constraint has an unexpected definition.';
  end if;

  drop index if exists
    public.push_subscriptions_onesignal_id_tenant_domain_key;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname = 'push_subscriptions'
      and con.conname = 'push_subscriptions_onesignal_id_key'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_onesignal_id_key
      unique (onesignal_id);
  end if;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname = 'push_subscriptions'
      and con.conname = 'push_subscriptions_onesignal_id_key'
      and con.contype = 'u'
      and pg_get_constraintdef(con.oid, true) = 'UNIQUE (onesignal_id)'
  ) then
    raise exception 'Rollback 006 aborted: global unique constraint was not restored.';
  end if;

  select count(*) into v_after_count
  from public.push_subscriptions;

  if v_after_count <> v_before_count then
    raise exception
      'Rollback 006 aborted: row count changed from % to %.',
      v_before_count,
      v_after_count;
  end if;

  raise notice
    'Rollback 006 complete: % rows preserved; global uniqueness restored.',
    v_after_count;
end;
$$;

commit;
