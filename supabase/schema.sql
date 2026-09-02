-- PWA-WL application baseline
--
-- Purpose: provision a NEW, empty Supabase project with the complete
-- application-owned schema. Do not run this file on an existing environment.
-- Historical migrations in supabase/migrations document how the shared
-- database evolved; they are not applied after this baseline.

begin;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Public application tables
-- ---------------------------------------------------------------------------

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  -- Legacy compatibility column. Multi-tenant identity is tenant_domain;
  -- singleton_key must not be unique in a database shared by many tenants.
  singleton_key boolean not null default true,
  tenant_domain text,
  app_name text,
  app_short_name text,
  app_description text,
  platform_url text,
  support_url text,
  public_url text,
  logo_url text,
  icon_192_url text,
  icon_512_url text,
  favicon_url text,
  theme_color text,
  background_color text,
  splash_title text,
  splash_message text,
  splash_image_url text,
  splash_html_url text,
  redirect_delay_ms integer default 1500,
  notifications_enabled boolean default false,
  onesignal_app_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create unique index if not exists app_settings_tenant_domain_idx
  on public.app_settings (tenant_domain);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  onesignal_id text not null,
  permission_status text not null default 'unknown',
  user_agent text,
  device_type text not null default 'web',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_domain text,
  onesignal_app_id text,
  constraint push_subscriptions_onesignal_id_tenant_domain_key
    unique (onesignal_id, tenant_domain)
);

create index if not exists push_subscriptions_created_at_idx
  on public.push_subscriptions (created_at desc);

create index if not exists push_subscriptions_tenant_domain_idx
  on public.push_subscriptions (tenant_domain);

create table if not exists public.push_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null,
  target_url text,
  target_type text not null default 'all',
  status text not null default 'draft',
  onesignal_notification_id text,
  recipient_count integer not null default 0,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  tenant_domain text,
  onesignal_app_id text,
  constraint push_campaigns_status_check
    check (status in ('created', 'sent', 'failed', 'draft'))
);

create index if not exists push_campaigns_created_at_idx
  on public.push_campaigns (created_at desc);

create index if not exists push_campaigns_tenant_domain_idx
  on public.push_campaigns (tenant_domain);

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique
    references auth.users (id) on delete cascade,
  email text not null unique,
  name text,
  role text not null check (role in ('super_admin', 'admin')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_tenant_access (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null
    references public.admin_users (id) on delete cascade,
  tenant_domain text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (admin_user_id, tenant_domain)
);

create index if not exists admin_tenant_access_admin_user_idx
  on public.admin_tenant_access (admin_user_id);

-- Client roles never access application tables directly. All application
-- reads and writes go through server-side routes using service_role.
alter table public.app_settings enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_campaigns enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_tenant_access enable row level security;

drop policy if exists "Allow public read app_settings" on public.app_settings;
drop policy if exists "Allow anonymous push subscription registration"
  on public.push_subscriptions;
drop policy if exists "Allow anonymous push subscription updates"
  on public.push_subscriptions;

revoke all on table public.app_settings from public, anon, authenticated;
revoke all on table public.push_subscriptions from public, anon, authenticated;
revoke all on table public.push_campaigns from public, anon, authenticated;
revoke all on table public.admin_users from public, anon, authenticated;
revoke all on table public.admin_tenant_access from public, anon, authenticated;

grant select, insert, update, delete on table public.app_settings to service_role;
grant select, insert, update, delete on table public.push_subscriptions to service_role;
grant select, insert, update, delete on table public.push_campaigns to service_role;
grant select, insert, update, delete on table public.admin_users to service_role;
grant select, insert, update, delete on table public.admin_tenant_access to service_role;

-- ---------------------------------------------------------------------------
-- Distributed rate limiting (migration 005 final state)
-- ---------------------------------------------------------------------------

create schema if not exists cetec_security;
revoke all on schema cetec_security from public, anon, authenticated;

create table if not exists cetec_security.rate_limit_buckets (
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  updated_at timestamptz not null,
  primary key (scope, key_hash),
  constraint rate_limit_scope_format check (scope ~ '^[a-z0-9:_-]{1,80}$'),
  constraint rate_limit_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists rate_limit_buckets_expires_at_idx
  on cetec_security.rate_limit_buckets (expires_at);

alter table cetec_security.rate_limit_buckets enable row level security;
revoke all on table cetec_security.rate_limit_buckets
  from public, anon, authenticated;

create or replace function public.consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_max_requests integer,
  p_window_seconds integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_count integer;
  v_expires_at timestamptz;
begin
  if p_scope !~ '^[a-z0-9:_-]{1,80}$'
    or p_key_hash !~ '^[0-9a-f]{64}$'
    or p_max_requests < 1 or p_max_requests > 10000
    or p_window_seconds < 1 or p_window_seconds > 604800 then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  delete from cetec_security.rate_limit_buckets
  where expires_at <= v_now;

  insert into cetec_security.rate_limit_buckets as bucket (
    scope,
    key_hash,
    window_started_at,
    expires_at,
    request_count,
    updated_at
  ) values (
    p_scope,
    p_key_hash,
    v_now,
    v_now + make_interval(secs => p_window_seconds),
    1,
    v_now
  )
  on conflict (scope, key_hash) do update
  set request_count = bucket.request_count + 1,
      updated_at = v_now
  returning bucket.request_count, bucket.expires_at
  into v_count, v_expires_at;

  return query
  select
    v_count <= p_max_requests,
    greatest(p_max_requests - v_count, 0),
    case
      when v_count <= p_max_requests then 0
      else greatest(1, ceil(extract(epoch from (v_expires_at - v_now)))::integer)
    end;
end;
$$;

create or replace function public.reset_rate_limit(
  p_scope text,
  p_key_hash text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_scope !~ '^[a-z0-9:_-]{1,80}$'
    or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate limit parameters' using errcode = '22023';
  end if;

  delete from cetec_security.rate_limit_buckets
  where scope = p_scope and key_hash = p_key_hash;
end;
$$;

revoke all on function public.consume_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, text, integer, integer)
  to service_role;

revoke all on function public.reset_rate_limit(text, text)
  from public, anon, authenticated;
grant execute on function public.reset_rate_limit(text, text)
  to service_role;

comment on table cetec_security.rate_limit_buckets is
  'Expiring HMAC-keyed counters for distributed application rate limiting.';
comment on function public.consume_rate_limit(text, text, integer, integer) is
  'Atomically consumes one request from a fixed-window bucket; service_role only.';
comment on function public.reset_rate_limit(text, text) is
  'Deletes one fixed-window bucket after a successful authenticated login; service_role only.';

-- ---------------------------------------------------------------------------
-- Supabase Storage application configuration
-- ---------------------------------------------------------------------------
-- storage schema/tables/functions are platform-managed and intentionally are
-- not recreated here. This baseline only owns the app-assets bucket and its
-- public-read policy. Upload writes remain server-only through service_role.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values ('app-assets', 'app-assets', true, null, null)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "allow all 1o5prjj_0" on storage.objects;
drop policy if exists "allow all 1o5prjj_1" on storage.objects;
drop policy if exists "allow all 1o5prjj_2" on storage.objects;
drop policy if exists "allow all 1o5prjj_3" on storage.objects;
drop policy if exists app_assets_public_read on storage.objects;

create policy app_assets_public_read
  on storage.objects
  for select
  to public
  using (bucket_id = 'app-assets');

commit;
