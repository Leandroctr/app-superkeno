-- Distributed fixed-window rate limiting for CETEC A-2 and A-5.
-- The table is private; only SECURITY DEFINER RPCs granted to service_role
-- can access it. Identifiers are stored only as server-side HMAC-SHA256 hashes.

begin;

create schema if not exists cetec_security;
revoke all on schema cetec_security from public, anon, authenticated;

create table cetec_security.rate_limit_buckets (
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

create index rate_limit_buckets_expires_at_idx
  on cetec_security.rate_limit_buckets (expires_at);

alter table cetec_security.rate_limit_buckets enable row level security;
revoke all on cetec_security.rate_limit_buckets from public, anon, authenticated;

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

  -- Every call removes all expired buckets. The expires_at index makes this
  -- bounded and prevents indefinite retention without a separate scheduler.
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

commit;
