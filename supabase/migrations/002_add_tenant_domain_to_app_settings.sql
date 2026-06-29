-- =============================================================
-- Migration: 002_add_tenant_domain_to_app_settings
-- Projeto: app-big-pwa
-- Data planejada: 2026-06-28
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
--   Cada deploy é identificado pelo hostname de NEXT_PUBLIC_PUBLIC_URL.
--
-- Ordem de execução dos passos (importante):
--   1. Adicionar coluna tenant_domain (DDL idempotente)
--   2. Validar placeholder — falha intencionalmente se não foi substituído
--   3. Preencher tenant_domain das linhas existentes com NULL
--   4. Validar que não restou nenhuma linha com tenant_domain NULL
--   5. Criar índice único (somente após validação aprovada)
--
--   Se qualquer passo falhar, a transação inteira é revertida.
--   Nenhum estado parcial é persistido.
-- =============================================================


-- =============================================================
-- CONFIGURAÇÃO OBRIGATÓRIA ANTES DE EXECUTAR
-- =============================================================
--
-- Passo obrigatório:
--   1. Abrir o painel do Vercel para este deploy.
--   2. Copiar o valor da variável de ambiente NEXT_PUBLIC_PUBLIC_URL.
--   3. Extrair somente o hostname (sem https://, sem path, sem porta).
--      Exemplo:
--        NEXT_PUBLIC_PUBLIC_URL = 'https://app.cliente.com'
--        hostname = 'app.cliente.com'
--   4. Substituir 'SUBSTITUIR_PELO_DOMINIO_DO_CLIENTE' na declaração
--      v_domain abaixo pelo hostname exato.
--
-- A migration falhará intencionalmente se o placeholder não for substituído.
-- Isso é um comportamento esperado — não é um bug.
-- =============================================================


begin;

-- -------------------------------------------------------------
-- Passo 1: adicionar coluna tenant_domain
-- -------------------------------------------------------------
-- Idempotente: ADD COLUMN IF NOT EXISTS não falha se a coluna já existir.
-- Tipo text sem NOT NULL: linhas legadas podem ter NULL até o passo 3.
-- singleton_key não é alterado nem removido.

alter table public.app_settings
  add column if not exists tenant_domain text;


-- -------------------------------------------------------------
-- Passos 2, 3 e 4: validar, preencher e verificar
-- -------------------------------------------------------------
-- Este bloco:
--   - Falha com mensagem clara se o placeholder não foi substituído.
--   - Falha com mensagem clara se o domínio contém protocolo (http/https).
--   - Preenche tenant_domain de todas as linhas onde está NULL.
--   - Falha com mensagem clara se ainda restarem linhas com NULL após o UPDATE.
--   - Só termina com sucesso quando nenhum NULL restar.
--
-- Se qualquer RAISE EXCEPTION for acionado, toda a transação é revertida,
-- incluindo o ADD COLUMN do passo 1.

do $$
declare
  v_domain    text    := 'SUBSTITUIR_PELO_DOMINIO_DO_CLIENTE';
  v_updated   integer;
  v_null_count integer;
begin

  -- Passo 2: validar que o placeholder foi substituído
  if v_domain = 'SUBSTITUIR_PELO_DOMINIO_DO_CLIENTE' then
    raise exception
      E'MIGRATION ABORTADA — placeholder não substituído.\n'
      'Substitua ''SUBSTITUIR_PELO_DOMINIO_DO_CLIENTE'' pelo hostname real do deploy.\n'
      'Exemplo: v_domain text := ''app.cliente.com'';';
  end if;

  -- Passo 2b: validar que não foi passada a URL completa por engano
  if v_domain like 'http://%' or v_domain like 'https://%' then
    raise exception
      E'MIGRATION ABORTADA — v_domain contém protocolo.\n'
      'Use somente o hostname, sem https:// e sem path.\n'
      'Recebido: ''%''\n'
      'Correto:  ''app.cliente.com''',
      v_domain;
  end if;

  if v_domain = '' then
    raise exception
      'MIGRATION ABORTADA — v_domain está vazio. Defina o hostname do deploy.';
  end if;

  -- Passo 3: preencher tenant_domain das linhas com NULL
  update public.app_settings
  set    tenant_domain = v_domain
  where  tenant_domain is null;

  get diagnostics v_updated = row_count;
  raise notice 'Passo 3 OK: % linha(s) atualizada(s) com tenant_domain = ''%''.', v_updated, v_domain;

  -- Passo 4: garantir que nenhuma linha ficou com NULL
  select count(*)
  into   v_null_count
  from   public.app_settings
  where  tenant_domain is null;

  if v_null_count > 0 then
    raise exception
      E'MIGRATION ABORTADA — ainda existem % linha(s) com tenant_domain NULL após o UPDATE.\n'
      'Verifique a tabela app_settings e corrija antes de criar o índice.',
      v_null_count;
  end if;

  raise notice 'Passo 4 OK: nenhuma linha com tenant_domain NULL. Prosseguindo para criação do índice.';

end $$;


-- -------------------------------------------------------------
-- Passo 5: criar índice único em tenant_domain
-- -------------------------------------------------------------
-- Só é executado se os passos 2, 3 e 4 foram bem-sucedidos.
-- Necessário para que .upsert({ onConflict: "tenant_domain" }) funcione.
-- Postgres permite múltiplas linhas com tenant_domain = NULL em índices únicos
-- porque NULL != NULL por padrão — mas após o passo 4 não há NULLs.
-- Idempotente: CREATE UNIQUE INDEX IF NOT EXISTS não falha se já existir.

create unique index if not exists app_settings_tenant_domain_key
  on public.app_settings (tenant_domain);

raise notice 'Passo 5 OK: índice app_settings_tenant_domain_key criado.';


commit;


-- =============================================================
-- Verificação pós-execução (executar manualmente após o commit)
-- =============================================================
--
-- 1. Confirmar coluna e valor:
--      SELECT id, tenant_domain, app_name, updated_at
--      FROM public.app_settings;
--
-- 2. Confirmar índice criado:
--      SELECT indexname, indexdef
--      FROM pg_indexes
--      WHERE tablename = 'app_settings'
--        AND indexname = 'app_settings_tenant_domain_key';
--
-- 3. Confirmar que o onConflict funciona (substituir pelo domínio real):
--      INSERT INTO public.app_settings (tenant_domain, app_name)
--      VALUES ('app.cliente.com', 'Teste Conflict')
--      ON CONFLICT (tenant_domain)
--      DO UPDATE SET app_name = EXCLUDED.app_name
--      RETURNING id, tenant_domain, app_name;
--      -- deve retornar 1 linha atualizada, não inserir nova
--
-- 4. Validar via API (após deploy com a migration aplicada):
--      GET /api/settings
--      -- "source" deve ser "database", não "env"
-- =============================================================
