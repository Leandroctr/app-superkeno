-- =============================================================
-- Rollback: 002_add_tenant_domain_to_app_settings
-- Projeto: app-big-pwa
-- Status: AGUARDANDO EXECUÇÃO CONDICIONAL
-- =============================================================
--
-- Quando usar:
--   Somente se a migration 002 foi aplicada ao banco e precisa ser revertida
--   por problema inesperado detectado imediatamente após a execução.
--
-- O que este rollback FAZ:
--   - Remove o índice único app_settings_tenant_domain_key.
--   - Remove a coluna tenant_domain e TODOS os valores nela armazenados.
--   - Não apaga nenhum outro dado (app_name, logo_url, cores, etc.).
--
-- O que este rollback NÃO FAZ:
--   - Não restaura os valores de tenant_domain (não há como — foram apagados).
--   - Não corrige o código — o código continua tentando usar tenant_domain
--     e voltará a operar em falha silenciosa após o rollback.
--   - Não faz deploy automático.
--
-- CONSEQUÊNCIAS DO ROLLBACK:
--   Após executar este rollback, o sistema fica em estado degradado:
--   - Todas as leituras de app_settings retornam fallback de env vars.
--   - O painel admin não consegue salvar configurações (UPSERT quebrado).
--   - O manifest e a splash exibem dados de env, não do banco.
--   O único caminho de recuperação é re-executar a migration 002.
--
-- Pré-requisitos obrigatórios ANTES de executar:
--   1. Confirmar que a migration 002 foi de fato aplicada ao banco.
--   2. Entender que o isolamento por tenant_domain será destruído.
--   3. Ter ciência de que o sistema ficará degradado até nova intervenção.
--   4. Não usar este rollback como medida rotineira — apenas em emergência.
-- =============================================================


begin;

-- -------------------------------------------------------------
-- Passo 1: remover índice único de tenant_domain
-- -------------------------------------------------------------
-- Idempotente: DROP INDEX IF EXISTS não falha se o índice não existir.
-- Remover o índice antes da coluna (dependência de objeto).

drop index if exists public.app_settings_tenant_domain_key;

raise notice 'Passo 1 OK: índice app_settings_tenant_domain_key removido (ou inexistente).';


-- -------------------------------------------------------------
-- Passo 2: remover coluna tenant_domain
-- -------------------------------------------------------------
-- ATENÇÃO: esta operação é IRREVERSÍVEL sem re-executar a migration.
-- Todos os valores de tenant_domain são perdidos permanentemente.
-- Os demais campos da tabela (app_name, logo_url, cores, etc.) são preservados.
-- Idempotente: DROP COLUMN IF EXISTS não falha se a coluna não existir.

alter table public.app_settings
  drop column if exists tenant_domain;

raise notice 'Passo 2 OK: coluna tenant_domain removida. ISOLAMENTO POR TENANT DESTRUÍDO.';
raise notice 'O sistema está agora em estado degradado. Re-execute a migration 002 para restaurar.';


commit;


-- =============================================================
-- Verificação pós-rollback (executar manualmente)
-- =============================================================
--
-- 1. Confirmar que a coluna foi removida:
--      SELECT column_name
--      FROM information_schema.columns
--      WHERE table_name  = 'app_settings'
--        AND column_name = 'tenant_domain';
--      -- deve retornar 0 rows
--
-- 2. Confirmar que o índice foi removido:
--      SELECT indexname
--      FROM pg_indexes
--      WHERE tablename = 'app_settings'
--        AND indexname = 'app_settings_tenant_domain_key';
--      -- deve retornar 0 rows
--
-- 3. Confirmar que os dados restantes estão intactos:
--      SELECT id, singleton_key, app_name, updated_at
--      FROM public.app_settings;
--
-- 4. Validar via API (o sistema estará degradado — esperado após rollback):
--      GET /api/settings
--      -- "source" será "env" (fallback) — comportamento esperado pós-rollback
-- =============================================================
