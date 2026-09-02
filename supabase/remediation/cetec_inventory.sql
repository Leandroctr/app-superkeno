-- CETEC - inventario read-only do Supabase compartilhado
-- Data de preparacao: 2026-08-31
--
-- Este arquivo NAO altera schema nem dados. Execute-o inteiro no SQL Editor
-- e exporte todos os result sets antes de qualquer remediacao.

begin transaction isolation level repeatable read read only;

-- 0. Identificacao do snapshot (sem secrets).
select
  current_database() as database_name,
  current_user as executed_by,
  current_setting('server_version') as postgres_version,
  transaction_timestamp() as inventory_started_at;

-- 1. Policies de public.push_subscriptions.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'push_subscriptions'
order by policyname;

-- 2. Policies de public.app_settings.
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'app_settings'
order by policyname;

-- 3. Policies de storage.objects. Todas sao retornadas porque uma policy
-- global tambem alcanca app-assets mesmo sem citar o bucket pelo nome.
select
  policyname,
  roles,
  cmd,
  qual,
  with_check,
  case
    when lower(coalesce(qual, '') || ' ' || coalesce(with_check, ''))
           like '%app-assets%'
      then 'EXPLICIT_APP_ASSETS'
    when cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and roles && array['anon'::name, 'public'::name]
      and lower(coalesce(qual, '') || ' ' || coalesce(with_check, ''))
            not like '%bucket_id%'
      then 'GLOBAL_WRITE_REACHES_APP_ASSETS'
    else 'REVIEW'
  end as app_assets_relevance
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

-- 4. Grants registrados no ACL para anon/authenticated/PUBLIC.
select
  n.nspname as table_schema,
  c.relname as table_name,
  case
    when acl.grantee = 0 then 'PUBLIC'
    else pg_get_userbyid(acl.grantee)
  end as grantee,
  acl.privilege_type,
  acl.is_grantable
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join lateral aclexplode(
  coalesce(c.relacl, acldefault('r', c.relowner))
) acl
where n.nspname = 'public'
  and c.relname in ('push_subscriptions', 'app_settings')
  and c.relkind in ('r', 'p')
  and lower(
    case
      when acl.grantee = 0 then 'public'
      else pg_get_userbyid(acl.grantee)
    end
  ) in ('anon', 'authenticated', 'public')
order by table_name, grantee, privilege_type;

-- Resumo de privilegios efetivos, incluindo service_role.
select
  role_name,
  has_table_privilege(role_name, 'public.push_subscriptions', 'SELECT') as push_select,
  has_table_privilege(role_name, 'public.push_subscriptions', 'INSERT') as push_insert,
  has_table_privilege(role_name, 'public.push_subscriptions', 'UPDATE') as push_update,
  has_table_privilege(role_name, 'public.push_subscriptions', 'DELETE') as push_delete,
  has_table_privilege(role_name, 'public.app_settings', 'SELECT') as settings_select,
  has_table_privilege(role_name, 'public.app_settings', 'INSERT') as settings_insert,
  has_table_privilege(role_name, 'public.app_settings', 'UPDATE') as settings_update,
  has_table_privilege(role_name, 'public.app_settings', 'DELETE') as settings_delete
from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name)
order by role_name;

-- 5. Configuracao do bucket app-assets.
select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'app-assets';

-- 6. Estado de RLS.
select
  n.nspname as table_schema,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('push_subscriptions', 'app_settings')
  and c.relkind in ('r', 'p')
order by c.relname;

-- 7. Estrutura de admin_users e admin_tenant_access.
select
  c.table_schema,
  c.table_name,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('admin_users', 'admin_tenant_access')
order by c.table_name, c.ordinal_position;

select
  n.nspname as table_schema,
  cls.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class cls on cls.oid = con.conrelid
join pg_namespace n on n.oid = cls.relnamespace
where n.nspname = 'public'
  and cls.relname in ('admin_users', 'admin_tenant_access')
order by cls.relname, con.contype, con.conname;

select schemaname, tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('admin_users', 'admin_tenant_access', 'app_settings')
order by tablename, indexname;

-- Confirmacao especifica do indice unique de app_settings.tenant_domain.
select
  i.relname as index_name,
  ix.indisunique as is_unique,
  ix.indisvalid as is_valid,
  pg_get_indexdef(i.oid) as definition
from pg_index ix
join pg_class t on t.oid = ix.indrelid
join pg_namespace n on n.oid = t.relnamespace
join pg_class i on i.oid = ix.indexrelid
where n.nspname = 'public'
  and t.relname = 'app_settings'
  and pg_get_indexdef(i.oid) ilike '%tenant_domain%'
order by i.relname;

-- 8. Todas as tabelas que possuem tenant_domain.
select
  c.table_schema,
  c.table_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
from information_schema.columns c
join information_schema.tables t
  on t.table_schema = c.table_schema
 and t.table_name = c.table_name
where c.column_name = 'tenant_domain'
  and t.table_type = 'BASE TABLE'
  and c.table_schema not in ('pg_catalog', 'information_schema')
order by c.table_schema, c.table_name;

-- 9. Contagem por tenant_domain em TODAS as tabelas encontradas.
-- query_to_xml executa SELECT dinamico sem DDL ou tabela temporaria.
select
  tenant_tables.table_schema,
  tenant_tables.table_name,
  counts.tenant_domain,
  counts.row_count
from (
  select c.table_schema, c.table_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
  where c.column_name = 'tenant_domain'
    and t.table_type = 'BASE TABLE'
    and c.table_schema not in ('pg_catalog', 'information_schema')
) tenant_tables
cross join lateral xmltable(
  '/table/row'
  passing query_to_xml(
    format(
      'select tenant_domain, count(*)::bigint as row_count from %I.%I group by tenant_domain order by tenant_domain nulls first',
      tenant_tables.table_schema,
      tenant_tables.table_name
    ),
    true,
    false,
    ''
  )
  columns
    tenant_domain text path 'tenant_domain/text()',
    row_count bigint path 'row_count/text()'
) counts
order by tenant_tables.table_schema, tenant_tables.table_name, counts.tenant_domain nulls first;

-- 10. Referencias exatas ao tenant Apache em todas as tenant tables.
select
  tenant_tables.table_schema,
  tenant_tables.table_name,
  apache_rows.row_count
from (
  select c.table_schema, c.table_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
  where c.column_name = 'tenant_domain'
    and t.table_type = 'BASE TABLE'
    and c.table_schema not in ('pg_catalog', 'information_schema')
) tenant_tables
cross join lateral xmltable(
  '/table/row'
  passing query_to_xml(
    format(
      'select count(*)::bigint as row_count from %I.%I where tenant_domain = %L',
      tenant_tables.table_schema,
      tenant_tables.table_name,
      'pwa.app.apachejb.app'
    ),
    true,
    false,
    ''
  )
  columns row_count bigint path 'row_count/text()'
) apache_rows
where apache_rows.row_count > 0
order by tenant_tables.table_schema, tenant_tables.table_name;

-- Conteudo integral das linhas Apache, em XML por tabela, para export/backup.
select
  tenant_tables.table_schema,
  tenant_tables.table_name,
  query_to_xml(
    format(
      'select * from %I.%I where tenant_domain = %L order by 1',
      tenant_tables.table_schema,
      tenant_tables.table_name,
      'pwa.app.apachejb.app'
    ),
    true,
    false,
    ''
  ) as apache_rows_xml
from (
  select c.table_schema, c.table_name
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema
   and t.table_name = c.table_name
  where c.column_name = 'tenant_domain'
    and t.table_type = 'BASE TABLE'
    and c.table_schema not in ('pg_catalog', 'information_schema')
) tenant_tables
order by tenant_tables.table_schema, tenant_tables.table_name;

-- A linha de settings expoe tambem URLs de assets a inventariar. Nenhum
-- objeto de Storage sera removido automaticamente.
select *
from public.app_settings
where tenant_domain = 'pwa.app.apachejb.app';

-- FKs que podem influenciar a ordem/seguranca da remocao Apache.
select
  child_ns.nspname as child_schema,
  child.relname as child_table,
  con.conname as constraint_name,
  parent_ns.nspname as parent_schema,
  parent.relname as parent_table,
  con.condeferrable,
  con.condeferred,
  pg_get_constraintdef(con.oid, true) as definition
from pg_constraint con
join pg_class child on child.oid = con.conrelid
join pg_namespace child_ns on child_ns.oid = child.relnamespace
join pg_class parent on parent.oid = con.confrelid
join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
where con.contype = 'f'
  and (
    exists (
      select 1 from information_schema.columns c
      where c.table_schema = child_ns.nspname
        and c.table_name = child.relname
        and c.column_name = 'tenant_domain'
    )
    or exists (
      select 1 from information_schema.columns c
      where c.table_schema = parent_ns.nspname
        and c.table_name = parent.relname
        and c.column_name = 'tenant_domain'
    )
  )
order by child_schema, child_table, constraint_name;

commit;
