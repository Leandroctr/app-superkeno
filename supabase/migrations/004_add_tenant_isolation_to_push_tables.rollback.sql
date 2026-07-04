-- =============================================================
-- Rollback: 004_add_tenant_isolation_to_push_tables
-- =============================================================
-- Reverte a migration 004: remove as colunas e índices adicionados.
-- Não afeta as linhas existentes de push_subscriptions/push_campaigns
-- além de remover os valores das colunas removidas — nenhum outro dado
-- (onesignal_id, permission_status, title, message, etc.) é tocado.
-- =============================================================

begin;

drop index if exists public.push_subscriptions_tenant_domain_idx;
drop index if exists public.push_campaigns_tenant_domain_idx;

alter table public.push_subscriptions
  drop column if exists tenant_domain,
  drop column if exists onesignal_app_id;

alter table public.push_campaigns
  drop column if exists tenant_domain,
  drop column if exists onesignal_app_id;

commit;
