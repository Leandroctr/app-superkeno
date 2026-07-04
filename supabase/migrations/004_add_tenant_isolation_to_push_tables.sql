-- =============================================================
-- Migration: 004_add_tenant_isolation_to_push_tables
-- Projeto: app-big-pwa (banco compartilhado pelos 6 tenants)
-- Status: AGUARDANDO EXECUÇÃO — não executar sem aprovação e backup prévio
-- Rollback disponível: 004_add_tenant_isolation_to_push_tables.rollback.sql
-- =============================================================
--
-- Objetivo:
--   push_subscriptions e push_campaigns não têm nenhuma coluna de tenant.
--   Isso faz o /admin de qualquer tenant contar/listar inscritos de TODOS
--   os tenants, e faz "Enviar para todos" buscar permission_status =
--   'granted' sem filtro nenhum, misturando assinantes entre tenants.
--
-- Esta migration é 100% aditiva:
--   - Não apaga dado.
--   - Não dropa tabela.
--   - Não recria tabela.
--   - Não faz backfill das linhas existentes (ver nota abaixo).
--   - Não altera a constraint unique existente em onesignal_id.
--   - Não altera RLS.
--
-- Nota sobre as 33 linhas legadas de push_subscriptions (e 0 de
-- push_campaigns) existentes hoje:
--   Ficam com tenant_domain = NULL e onesignal_app_id = NULL, de propósito
--   — não há como saber a qual tenant pertencem sem checar contra a API da
--   OneSignal, o que fica fora desta etapa. O código passa a filtrar
--   sempre por .eq("tenant_domain", X); no Postgres/PostgREST uma
--   comparação .eq contra NULL nunca é verdadeira, então essas linhas
--   somem sozinhas de qualquer contagem/listagem/envio por tenant.
-- =============================================================

begin;

alter table public.push_subscriptions
  add column if not exists tenant_domain text,
  add column if not exists onesignal_app_id text;

alter table public.push_campaigns
  add column if not exists tenant_domain text,
  add column if not exists onesignal_app_id text;

create index if not exists push_subscriptions_tenant_domain_idx
  on public.push_subscriptions (tenant_domain);

create index if not exists push_campaigns_tenant_domain_idx
  on public.push_campaigns (tenant_domain);

commit;

-- =============================================================
-- Verificação pós-execução (rodar manualmente, só leitura)
-- =============================================================
-- 1. Confirmar colunas novas:
--      select table_name, column_name from information_schema.columns
--      where table_name in ('push_subscriptions','push_campaigns')
--        and column_name in ('tenant_domain','onesignal_app_id')
--      order by table_name, column_name;
--
-- 2. Confirmar que as linhas antigas ficaram NULL (esperado):
--      select count(*) from public.push_subscriptions where tenant_domain is null;
--      -- esperado: 33 (nenhuma linha nova ainda)
--      select count(*) from public.push_campaigns where tenant_domain is null;
--      -- esperado: 0 (tabela vazia hoje)
--
-- 3. Confirmar índices criados:
--      select indexname from pg_indexes
--      where tablename in ('push_subscriptions','push_campaigns')
--        and indexname like '%tenant_domain%';
-- =============================================================
