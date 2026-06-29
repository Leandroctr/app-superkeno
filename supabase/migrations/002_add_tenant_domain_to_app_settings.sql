-- =============================================================
-- Migration: 002_add_tenant_domain_to_app_settings
-- Projeto: app-big-pwa
-- Data planejada: 2026-06-28
-- Atualizado em: 2026-06-29 — lógica ajustada para banco com dois tenants
-- Status: AGUARDANDO EXECUÇÃO — não executar sem aprovação e backup prévio
-- Rollback disponível: 002_add_tenant_domain_to_app_settings.rollback.sql
-- =============================================================
--
-- Objetivo:
--   Alinhar supabase/schema.sql ao código que já usa tenant_domain.
--   O código atual filtra app_settings por .eq("tenant_domain", hostname)
--   e salva com .upsert({ onConflict: "tenant_domain" }).
--   Sem esta migration o sistema opera em fallback silencioso (env vars)
--   e o painel admin não consegue salvar configurações.
--
-- Arquitetura:
--   Banco único compartilhado. Isolamento por tenant_domain.
--   Cada linha é identificada pelo hostname extraído de public_url.
--
-- Dados esperados antes de executar:
--   id 34d1e99f... / Big Pix     / public_url https://pwa.app-bigpix.com
--   id 4d72e1d0... / MegaBingo7  / public_url https://pwa.app-megabingo7.com
--
-- Ordem de execução dos passos:
--   1. Adicionar coluna tenant_domain (DDL idempotente)
--   2. Preencher tenant_domain de cada linha a partir de public_url
--      (remove protocolo https?:// e barra final)
--   3. Validar que nenhuma linha ficou com tenant_domain NULL
--   4. Validar que não há valores duplicados em tenant_domain
--   5. Criar índice único (somente após validações aprovadas)
--
--   Se qualquer passo falhar, a transação inteira é revertida.
--   Nenhum estado parcial é persistido.
--
-- Não há placeholder para substituir — a lógica lê public_url do próprio banco.
-- =============================================================


begin;


-- -------------------------------------------------------------
-- Passo 1: adicionar coluna tenant_domain
-- -------------------------------------------------------------
-- Idempotente: ADD COLUMN IF NOT EXISTS não falha se a coluna já existir.
-- Tipo text sem NOT NULL: linhas com public_url preenchido serão migradas no passo 2.
-- singleton_key não é alterado nem removido.

alter table public.app_settings
  add column if not exists tenant_domain text;


-- -------------------------------------------------------------
-- Passos 2, 3 e 4: preencher e validar
-- -------------------------------------------------------------

do $$
declare
  v_updated    integer;
  v_null_count integer;
  v_dup_count  integer;
begin

  -- Passo 2: preencher tenant_domain a partir de public_url
  --   - remove o protocolo (https:// ou http://)
  --   - remove a barra final, se existir
  --   - só atualiza linhas onde tenant_domain ainda é NULL
  --     e public_url está preenchido
  update public.app_settings
  set    tenant_domain = regexp_replace(
                           regexp_replace(public_url, '^https?://', ''),
                           '/$', ''
                         )
  where  tenant_domain is null
    and  public_url    is not null
    and  public_url    <> '';

  get diagnostics v_updated = row_count;
  raise notice 'Passo 2 OK: % linha(s) atualizada(s) com tenant_domain extraído de public_url.', v_updated;


  -- Passo 3: garantir que nenhuma linha ficou com tenant_domain NULL
  select count(*)
  into   v_null_count
  from   public.app_settings
  where  tenant_domain is null;

  if v_null_count > 0 then
    raise exception
      E'MIGRATION ABORTADA — % linha(s) com tenant_domain NULL após o UPDATE.\n'
      'Verifique se todas as linhas de app_settings têm public_url preenchido.\n'
      'Corrija public_url antes de executar esta migration.',
      v_null_count;
  end if;

  raise notice 'Passo 3 OK: nenhuma linha com tenant_domain NULL.';


  -- Passo 4: garantir que não há tenant_domain duplicado
  select count(*)
  into   v_dup_count
  from (
    select tenant_domain
    from   public.app_settings
    group  by tenant_domain
    having count(*) > 1
  ) duplicates;

  if v_dup_count > 0 then
    raise exception
      E'MIGRATION ABORTADA — % valor(es) de tenant_domain duplicado(s) encontrado(s).\n'
      'Dois ou mais registros têm o mesmo public_url.\n'
      'Corrija os dados antes de criar o índice único.',
      v_dup_count;
  end if;

  raise notice 'Passo 4 OK: nenhum tenant_domain duplicado. Prosseguindo para criação do índice.';

end $$;


-- -------------------------------------------------------------
-- Passo 5: criar índice único em tenant_domain
-- -------------------------------------------------------------
-- Só é executado se os passos 2, 3 e 4 foram bem-sucedidos.
-- Necessário para que .upsert({ onConflict: "tenant_domain" }) funcione.
-- Idempotente: CREATE UNIQUE INDEX IF NOT EXISTS não falha se já existir.

create unique index if not exists app_settings_tenant_domain_key
  on public.app_settings (tenant_domain);

raise notice 'Passo 5 OK: índice app_settings_tenant_domain_key criado.';


commit;


-- =============================================================
-- Verificação pós-execução (executar manualmente após o commit)
-- =============================================================
--
-- 1. Confirmar coluna e valores:
--      SELECT id, tenant_domain, app_name, public_url, updated_at
--      FROM public.app_settings;
--
--    Resultado esperado:
--      34d1e99f... | pwa.app-bigpix.com     | Big Pix    | https://pwa.app-bigpix.com
--      4d72e1d0... | pwa.app-megabingo7.com | MegaBingo7 | https://pwa.app-megabingo7.com
--
-- 2. Confirmar índice criado:
--      SELECT indexname, indexdef
--      FROM pg_indexes
--      WHERE tablename = 'app_settings'
--        AND indexname = 'app_settings_tenant_domain_key';
--
-- 3. Confirmar que o onConflict funciona (substituir pelo domínio real):
--      INSERT INTO public.app_settings (tenant_domain, app_name)
--      VALUES ('pwa.app-bigpix.com', 'Teste Conflict')
--      ON CONFLICT (tenant_domain)
--      DO UPDATE SET app_name = EXCLUDED.app_name
--      RETURNING id, tenant_domain, app_name;
--      -- deve retornar 1 linha atualizada, não inserir nova
--
-- 4. Validar via API (após execução da migration):
--      GET /api/settings
--      -- "source" deve ser "database", não "env"
--      -- testar para cada domínio (bigpix e megabingo7)
-- =============================================================
