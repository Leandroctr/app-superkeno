-- CETEC - remediacao C-1, C-3 e M-9
-- Data de preparacao: 2026-08-31
-- STATUS: EXECUTADO em 2026-08-31 no projeto Supabase PWA-WL.
-- O batch cetec-security-2026-08-31 impede reexecucao acidental.
--
-- PRE-REQUISITOS OBRIGATORIOS:
--   1. Executar cetec_inventory.sql e exportar todos os resultados.
--   2. Revisar manualmente TODAS as policies de storage.objects.
--   3. Fazer backup logico do banco.
--   4. Confirmar que o bucket app-assets existe.
--   5. Executar este arquivo inteiro em uma unica sessao.
--
-- O script salva nomes/definicoes reais de policies, grants removidos e
-- configuracao do bucket em cetec_audit.security_snapshot. O rollback usa
-- esse snapshot; nao depende dos nomes previstos pelo repositorio.

begin;

select pg_advisory_xact_lock(hashtextextended('cetec-security-remediation-2026-08-31', 0));

-- -------------------------------------------------------------------------
-- 0. Preflight
-- -------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.push_subscriptions') is null then
    raise exception 'Preflight abortado: public.push_subscriptions nao existe.';
  end if;

  if to_regclass('public.app_settings') is null then
    raise exception 'Preflight abortado: public.app_settings nao existe.';
  end if;

  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise exception 'Preflight abortado: tabelas do Supabase Storage nao existem.';
  end if;

  if not exists (select 1 from storage.buckets where id = 'app-assets') then
    raise exception 'Preflight abortado: bucket app-assets nao existe.';
  end if;

  if to_regrole('service_role') is null then
    raise exception 'Preflight abortado: role service_role nao existe.';
  end if;

  if not has_table_privilege('service_role', 'public.push_subscriptions', 'INSERT')
     or not has_table_privilege('service_role', 'public.push_subscriptions', 'UPDATE') then
    raise exception 'Preflight abortado: service_role nao possui INSERT/UPDATE em push_subscriptions.';
  end if;

  if not has_table_privilege('service_role', 'public.app_settings', 'SELECT') then
    raise exception 'Preflight abortado: service_role nao possui SELECT em app_settings.';
  end if;
end
$$;

-- -------------------------------------------------------------------------
-- 1. Snapshot imutavel para rollback/auditoria
-- -------------------------------------------------------------------------
create schema if not exists cetec_audit authorization postgres;
revoke all on schema cetec_audit from public, anon, authenticated;

create table if not exists cetec_audit.security_snapshot (
  batch_id text not null,
  captured_at timestamptz not null default now(),
  object_type text not null,
  schema_name text not null,
  table_name text not null,
  object_name text not null,
  definition jsonb not null,
  primary key (batch_id, object_type, schema_name, table_name, object_name)
);

revoke all on all tables in schema cetec_audit from public, anon, authenticated;

-- Impede sobrescrever evidencias de uma execucao anterior.
do $$
begin
  if exists (
    select 1
    from cetec_audit.security_snapshot
    where batch_id = 'cetec-security-2026-08-31'
  ) then
    raise exception 'Snapshot cetec-security-2026-08-31 ja existe; remediacao abortada.';
  end if;
end
$$;

-- Policies que serao removidas:
-- C-1: INSERT/UPDATE/ALL anon ou PUBLIC em push_subscriptions.
-- M-9: SELECT/ALL anon ou PUBLIC em app_settings.
-- C-3: write policy anon/PUBLIC que cita app-assets OU e global (nao limita
--      por bucket_id), portanto tambem alcanca app-assets.
insert into cetec_audit.security_snapshot (
  batch_id, object_type, schema_name, table_name, object_name, definition
)
select
  'cetec-security-2026-08-31',
  'policy',
  p.schemaname,
  p.tablename,
  p.policyname,
  jsonb_build_object(
    'permissive', p.permissive,
    'roles', to_jsonb(p.roles),
    'cmd', p.cmd,
    'qual', p.qual,
    'with_check', p.with_check
  )
from pg_policies p
where
  (
    p.schemaname = 'public'
    and p.tablename = 'push_subscriptions'
    and p.cmd in ('INSERT', 'UPDATE', 'ALL')
    and p.roles && array['anon'::name, 'public'::name]
  )
  or
  (
    p.schemaname = 'public'
    and p.tablename = 'app_settings'
    and p.cmd in ('SELECT', 'ALL')
    and p.roles && array['anon'::name, 'public'::name]
  )
  or
  (
    p.schemaname = 'storage'
    and p.tablename = 'objects'
    and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and p.roles && array['anon'::name, 'public'::name]
    and (
      lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
        like '%app-assets%'
      or lower(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''))
        not like '%bucket_id%'
    )
  );

-- Grants que serao revogados em tabelas public.
insert into cetec_audit.security_snapshot (
  batch_id, object_type, schema_name, table_name, object_name, definition
)
select
  'cetec-security-2026-08-31',
  'grant',
  n.nspname,
  c.relname,
  (case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end)
    || ':' || acl.privilege_type,
  jsonb_build_object(
    'grantee', case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
    'privilege_type', acl.privilege_type,
    'is_grantable', acl.is_grantable
  )
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
  and (
    (
      c.relname = 'push_subscriptions'
      and acl.privilege_type in ('INSERT', 'UPDATE')
    )
    or
    (
      c.relname = 'app_settings'
      and acl.privilege_type = 'SELECT'
    )
  )
  and lower(
    case when acl.grantee = 0 then 'public' else pg_get_userbyid(acl.grantee) end
  ) in ('anon', 'authenticated', 'public');

-- Configuracao exata do bucket antes da remediacao. Nesta etapa ela deve
-- permanecer integralmente inalterada; somente write policies serao removidas.
insert into cetec_audit.security_snapshot (
  batch_id, object_type, schema_name, table_name, object_name, definition
)
select
  'cetec-security-2026-08-31',
  'bucket',
  'storage',
  'buckets',
  b.id,
  jsonb_build_object(
    'id', b.id,
    'name', b.name,
    'public', b.public,
    'file_size_limit', b.file_size_limit,
    'allowed_mime_types', to_jsonb(b.allowed_mime_types)
  )
from storage.buckets b
where b.id = 'app-assets';

-- -------------------------------------------------------------------------
-- 2. C-1 - fechar escrita anon/client-side em push_subscriptions
-- -------------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and roles && array['anon'::name, 'public'::name]
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

revoke insert, update on table public.push_subscriptions from anon, authenticated;
revoke insert, update on table public.push_subscriptions from public;

-- -------------------------------------------------------------------------
-- 3. C-3 - remover write policies publicas/anon que alcancam app-assets
-- -------------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and roles && array['anon'::name, 'public'::name]
      and (
        lower(coalesce(qual, '') || ' ' || coalesce(with_check, ''))
          like '%app-assets%'
        or lower(coalesce(qual, '') || ' ' || coalesce(with_check, ''))
          not like '%bucket_id%'
      )
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

-- Nao alterar storage.buckets nesta etapa. O flag public, file_size_limit e
-- allowed_mime_types permanecem exatamente como encontrados no inventario.

-- -------------------------------------------------------------------------
-- 4. M-9 - remover leitura direta anon/client-side de app_settings
-- -------------------------------------------------------------------------
do $$
declare
  p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'app_settings'
      and cmd in ('SELECT', 'ALL')
      and roles && array['anon'::name, 'public'::name]
  loop
    execute format('drop policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end
$$;

revoke select on table public.app_settings from anon, authenticated;
revoke select on table public.app_settings from public;

-- -------------------------------------------------------------------------
-- 5. Guardas pos-mudanca (qualquer falha faz ROLLBACK da transacao inteira)
-- -------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'push_subscriptions'
      and cmd in ('INSERT', 'UPDATE', 'ALL')
      and roles && array['anon'::name, 'public'::name]
  ) then
    raise exception 'Pos-check falhou: ainda existe write policy anon/PUBLIC em push_subscriptions.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_settings'
      and cmd in ('SELECT', 'ALL')
      and roles && array['anon'::name, 'public'::name]
  ) then
    raise exception 'Pos-check falhou: ainda existe SELECT policy anon/PUBLIC em app_settings.';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and roles && array['anon'::name, 'public'::name]
      and (
        lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%app-assets%'
        or lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) not like '%bucket_id%'
      )
  ) then
    raise exception 'Pos-check falhou: ainda existe write policy anon/PUBLIC alcancando app-assets.';
  end if;

  if not exists (
    select 1
    from storage.buckets b
    join cetec_audit.security_snapshot s
      on s.batch_id = 'cetec-security-2026-08-31'
     and s.object_type = 'bucket'
     and s.schema_name = 'storage'
     and s.table_name = 'buckets'
     and s.object_name = b.id
    where b.id = 'app-assets'
      and b.name is not distinct from (s.definition ->> 'name')
      and b.public is not distinct from (s.definition ->> 'public')::boolean
      and b.file_size_limit is not distinct from
        (s.definition ->> 'file_size_limit')::bigint
      and coalesce(to_jsonb(b.allowed_mime_types), 'null'::jsonb)
        is not distinct from (s.definition -> 'allowed_mime_types')
  ) then
    raise exception 'Pos-check falhou: configuracao do bucket app-assets foi alterada.';
  end if;

  if not has_table_privilege('service_role', 'public.push_subscriptions', 'INSERT')
     or not has_table_privilege('service_role', 'public.push_subscriptions', 'UPDATE') then
    raise exception 'Pos-check falhou: service_role perdeu escrita em push_subscriptions.';
  end if;

  if not has_table_privilege('service_role', 'public.app_settings', 'SELECT') then
    raise exception 'Pos-check falhou: service_role perdeu SELECT em app_settings.';
  end if;
end
$$;

commit;

-- Depois do COMMIT, executar o plano em CETEC_VALIDATION_PLAN.md.
