-- Rollback for 005_add_distributed_rate_limits.sql.
-- This removes only the dedicated CETEC P1 rate-limit objects.

begin;

drop function if exists public.reset_rate_limit(text, text);
drop function if exists public.consume_rate_limit(text, text, integer, integer);
drop table if exists cetec_security.rate_limit_buckets;
drop schema if exists cetec_security;

commit;
