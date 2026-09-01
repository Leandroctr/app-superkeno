-- Scope OneSignal subscription identity by tenant for CETEC A-5.
-- This migration changes only uniqueness metadata; it never updates rows.

begin;

lock table public.push_subscriptions in share row exclusive mode;

do $$
declare
  v_before_count bigint;
  v_after_count bigint;
  v_duplicate_pairs bigint;
begin
  if to_regclass('public.push_subscriptions') is null then
    raise exception 'Migration 006 aborted: public.push_subscriptions does not exist.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and column_name = 'onesignal_id'
      and is_nullable = 'NO'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'push_subscriptions'
      and column_name = 'tenant_domain'
  ) then
    raise exception 'Migration 006 aborted: required columns are missing or invalid.';
  end if;

  select count(*) into v_before_count
  from public.push_subscriptions;

  select count(*) into v_duplicate_pairs
  from (
    select onesignal_id, tenant_domain
    from public.push_subscriptions
    where tenant_domain is not null
    group by onesignal_id, tenant_domain
    having count(*) > 1
  ) duplicates;

  if v_duplicate_pairs > 0 then
    raise exception
      'Migration 006 aborted: % duplicate non-null tenant/subscription pair(s).',
      v_duplicate_pairs;
  end if;

  if exists (
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
    alter table public.push_subscriptions
      drop constraint push_subscriptions_onesignal_id_key;
  elsif exists (
    select 1
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname = 'push_subscriptions'
      and con.conname = 'push_subscriptions_onesignal_id_key'
  ) then
    raise exception
      'Migration 006 aborted: push_subscriptions_onesignal_id_key has an unexpected definition.';
  end if;

  drop index if exists public.push_subscriptions_onesignal_id_key;

  if not exists (
    select 1
    from pg_constraint con
    join pg_class cls on cls.oid = con.conrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname = 'push_subscriptions'
      and con.conname = 'push_subscriptions_onesignal_id_tenant_domain_key'
  ) then
    alter table public.push_subscriptions
      add constraint push_subscriptions_onesignal_id_tenant_domain_key
      unique (onesignal_id, tenant_domain);
  end if;

  if not exists (
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
    raise exception 'Migration 006 aborted: composite unique constraint was not created.';
  end if;

  if exists (
    select 1
    from pg_index ix
    join pg_class cls on cls.oid = ix.indrelid
    join pg_namespace n on n.oid = cls.relnamespace
    where n.nspname = 'public'
      and cls.relname = 'push_subscriptions'
      and ix.indisunique
      and not ix.indisprimary
      and pg_get_indexdef(ix.indexrelid) ~ '\(onesignal_id\)$'
  ) then
    raise exception 'Migration 006 aborted: a global unique index still exists.';
  end if;

  select count(*) into v_after_count
  from public.push_subscriptions;

  if v_after_count <> v_before_count then
    raise exception
      'Migration 006 aborted: row count changed from % to %.',
      v_before_count,
      v_after_count;
  end if;

  raise notice
    'Migration 006 complete: % rows preserved; uniqueness is now tenant-scoped.',
    v_after_count;
end;
$$;

commit;
