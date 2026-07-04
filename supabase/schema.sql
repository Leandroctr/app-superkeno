create extension if not exists "pgcrypto";

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  onesignal_id text not null unique,
  permission_status text not null default 'unknown',
  user_agent text,
  device_type text not null default 'web',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_domain text,
  onesignal_app_id text
);

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
  onesignal_app_id text
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  singleton_key boolean not null default true unique,
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
  redirect_delay_ms integer default 1500,
  notifications_enabled boolean default false,
  onesignal_app_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.app_settings
  add column if not exists splash_image_url text;

alter table public.app_settings
  add column if not exists splash_html_url text;

insert into public.app_settings (
  singleton_key,
  app_name,
  app_short_name,
  app_description,
  platform_url,
  support_url,
  public_url,
  logo_url,
  icon_192_url,
  icon_512_url,
  favicon_url,
  theme_color,
  background_color,
  splash_title,
  splash_message,
  splash_image_url,
  redirect_delay_ms,
  notifications_enabled,
  onesignal_app_id
)
values (
  true,
  'App Big',
  'App Big',
  'PWA mobile-first para acesso rapido a plataforma.',
  '#',
  '#',
  '',
  '',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '',
  '#101828',
  '#f6f7fb',
  'App Big',
  'Carregando ambiente seguro...',
  '',
  1500,
  false,
  ''
)
on conflict (singleton_key) do nothing;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'push_campaigns_status_check'
  ) then
    alter table public.push_campaigns
      add constraint push_campaigns_status_check
      check (status in ('created', 'sent', 'failed', 'draft'));
  end if;
end $$;

alter table public.push_subscriptions enable row level security;
alter table public.push_campaigns enable row level security;
alter table public.app_settings enable row level security;

insert into storage.buckets (id, name, public)
values ('app-assets', 'app-assets', true)
on conflict (id) do update set public = excluded.public;

create policy "Allow anonymous push subscription registration"
  on public.push_subscriptions
  for insert
  to anon
  with check (true);

create policy "Allow anonymous push subscription updates"
  on public.push_subscriptions
  for update
  to anon
  using (onesignal_id is not null)
  with check (onesignal_id is not null);

create index if not exists push_subscriptions_created_at_idx
  on public.push_subscriptions (created_at desc);

create index if not exists push_campaigns_created_at_idx
  on public.push_campaigns (created_at desc);

create index if not exists push_subscriptions_tenant_domain_idx
  on public.push_subscriptions (tenant_domain);

create index if not exists push_campaigns_tenant_domain_idx
  on public.push_campaigns (tenant_domain);
