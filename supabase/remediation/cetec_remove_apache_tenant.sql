-- CETEC - remocao controlada do tenant Apache descartado
-- Tenant exato: pwa.app.apachejb.app
-- Data de preparacao: 2026-08-31
-- STATUS: EXECUTADO em 2026-08-31 no projeto Supabase PWA-WL e novamente
-- DESATIVADO para impedir reexecucao acidental.
--
-- SEGURANCA:
--   - O bloco de remocao usa v_execute := false por padrao.
--   - Antes de ativar, executar cetec_inventory.sql, exportar os resultados
--     e fazer backup logico do banco.
--   - Para aplicar futuramente, alterar UMA linha para v_execute := true.
--   - Todas as linhas sao copiadas para cetec_audit.apache_row_backup antes
--     do primeiro DELETE.
--   - A ordem de DELETE e calculada por FKs (filhos antes dos pais).
--   - Dependencia externa ou ciclo de FKs aborta a transacao inteira.
--   - Nenhum objeto de Storage e apagado automaticamente.

-- -------------------------------------------------------------------------
-- PREVIEW READ-ONLY: lista contagens e linhas antes de qualquer transacao.
-- -------------------------------------------------------------------------
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
  ) as rows_that_will_be_removed
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

-- Assets citados pela configuracao devem ser inventariados, mas nao serao
-- removidos por este script porque paths/ownership nao sao tenant-safe.
select *
from public.app_settings
where tenant_domain = 'pwa.app.apachejb.app';

begin;

select pg_advisory_xact_lock(hashtextextended('cetec-remove-apache-tenant-2026-08-31', 0));

create schema if not exists cetec_audit authorization postgres;
revoke all on schema cetec_audit from public, anon, authenticated;

create table if not exists cetec_audit.apache_row_backup (
  batch_id text not null,
  backed_up_at timestamptz not null default now(),
  tenant_domain text not null,
  schema_name text not null,
  table_name text not null,
  row_hash text not null,
  row_data jsonb not null,
  primary key (batch_id, schema_name, table_name, row_hash)
);

create table if not exists cetec_audit.apache_deletion_manifest (
  batch_id text not null,
  tenant_domain text not null,
  schema_name text not null,
  table_name text not null,
  deletion_order integer not null,
  row_count bigint not null,
  primary key (batch_id, schema_name, table_name)
);

revoke all on all tables in schema cetec_audit from public, anon, authenticated;

do $$
declare
  -- TRAVA OPERACIONAL: mudar para true somente depois de revisar/exportar o
  -- preview acima e possuir backup logico externo.
  v_execute constant boolean := false;
  v_tenant constant text := 'pwa.app.apachejb.app';
  v_batch constant text := 'cetec-apache-removal-2026-08-31';
  v_official_tenants constant text[] := array[
    'pwa.app-bigpix.com',
    'pwa.app-megabingo7.com',
    'pwa.app-obapremios.com',
    'pwa.app-premiosaovivo.com',
    'pwa.app-pixkeno.com',
    'pwa.app-superkeno.com',
    -- Presente neste mesmo Supabase conforme inventario de 2026-08-31.
    'pwa.bingonacional.com'
  ];
  candidate record;
  target record;
  v_order integer := 0;
  v_remaining integer;
  v_backed_up bigint;
  v_deleted bigint;
  v_count bigint;
begin
  if not v_execute then
    raise exception
      'REMOCAO DESATIVADA: revise o preview e altere v_execute para true somente na janela aprovada.';
  end if;

  if v_tenant = any(v_official_tenants) then
    raise exception 'Tenant alvo pertence a lista oficial; remocao abortada.';
  end if;

  if exists (
    select 1 from cetec_audit.apache_deletion_manifest where batch_id = v_batch
  ) or exists (
    select 1 from cetec_audit.apache_row_backup where batch_id = v_batch
  ) then
    raise exception 'Batch % ja possui backup/manifest; remocao abortada.', v_batch;
  end if;

  create temporary table cetec_target_tables on commit drop as
  select
    c.oid as table_oid,
    n.nspname as schema_name,
    c.relname as table_name,
    0::bigint as apache_row_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a
    on a.attrelid = c.oid
   and a.attname = 'tenant_domain'
   and not a.attisdropped
  where c.relkind in ('r', 'p')
    and not exists (
      select 1 from pg_inherits inheritance where inheritance.inhrelid = c.oid
    )
    and n.nspname not in ('pg_catalog', 'information_schema', 'cetec_audit');

  if not exists (select 1 from cetec_target_tables) then
    raise exception 'Nenhuma tabela com tenant_domain encontrada.';
  end if;

  for target in select * from cetec_target_tables
  loop
    execute format(
      'select count(*) from %I.%I where tenant_domain = $1',
      target.schema_name,
      target.table_name
    ) into v_count using v_tenant;

    update cetec_target_tables
    set apache_row_count = v_count
    where table_oid = target.table_oid;
  end loop;

  if not exists (
    select 1 from cetec_target_tables where apache_row_count > 0
  ) then
    raise exception 'Nenhuma linha do tenant Apache encontrada; nada a remover.';
  end if;

  -- Se uma tabela que nao sera apagada referencia uma target table com linhas
  -- Apache, nao e seguro inferir quais linhas filhas dependem do alvo.
  if exists (
    select 1
    from pg_constraint fk
    join cetec_target_tables parent
      on parent.table_oid = fk.confrelid
     and parent.apache_row_count > 0
    left join cetec_target_tables child
      on child.table_oid = fk.conrelid
     and child.apache_row_count > 0
    where fk.contype = 'f'
      and child.table_oid is null
  ) then
    raise exception
      'FK externa aponta para tabela tenant; inventario/manual delete necessario. Nada foi removido.';
  end if;

  create temporary table cetec_delete_order (
    table_oid oid primary key,
    schema_name text not null,
    table_name text not null,
    deletion_order integer not null unique
  ) on commit drop;

  -- Ordenacao topologica: tabela que nao e pai de outra target table ainda
  -- pendente e apagada primeiro. Self-FK e ignorada porque o DELETE e set-based.
  loop
    select count(*)
    into v_remaining
    from cetec_target_tables t
    where t.apache_row_count > 0
      and not exists (
      select 1 from cetec_delete_order done where done.table_oid = t.table_oid
    );

    exit when v_remaining = 0;

    select t.*
    into candidate
    from cetec_target_tables t
    where t.apache_row_count > 0
      and not exists (
      select 1 from cetec_delete_order done where done.table_oid = t.table_oid
    )
      and not exists (
        select 1
        from pg_constraint fk
        join cetec_target_tables child
          on child.table_oid = fk.conrelid
         and child.apache_row_count > 0
        where fk.contype = 'f'
          and fk.confrelid = t.table_oid
          and fk.conrelid <> fk.confrelid
          and not exists (
            select 1 from cetec_delete_order child_done
            where child_done.table_oid = child.table_oid
          )
      )
    order by t.schema_name, t.table_name
    limit 1;

    if not found then
      raise exception 'Ciclo de FKs entre tenant tables; remocao automatica abortada.';
    end if;

    v_order := v_order + 1;
    insert into cetec_delete_order
      (table_oid, schema_name, table_name, deletion_order)
    values
      (candidate.table_oid, candidate.schema_name, candidate.table_name, v_order);

  end loop;

  -- Backup e DELETE, filhos antes dos pais.
  for target in
    select * from cetec_delete_order order by deletion_order
  loop
    execute format(
      'insert into cetec_audit.apache_row_backup '
      || '(batch_id, tenant_domain, schema_name, table_name, row_hash, row_data) '
      || 'select $1, $2, $3, $4, md5(to_jsonb(src)::text), to_jsonb(src) '
      || 'from %I.%I src where src.tenant_domain = $2',
      target.schema_name,
      target.table_name
    )
    using v_batch, v_tenant, target.schema_name, target.table_name;

    get diagnostics v_backed_up = row_count;

    insert into cetec_audit.apache_deletion_manifest (
      batch_id, tenant_domain, schema_name, table_name, deletion_order, row_count
    ) values (
      v_batch, v_tenant, target.schema_name, target.table_name,
      target.deletion_order, v_backed_up
    );

    execute format(
      'delete from %I.%I where tenant_domain = $1',
      target.schema_name,
      target.table_name
    ) using v_tenant;

    get diagnostics v_deleted = row_count;

    if v_deleted <> v_backed_up then
      raise exception
        'Contagem divergente em %.%: backup %, delete %.',
        target.schema_name, target.table_name, v_backed_up, v_deleted;
    end if;
  end loop;

  -- Pos-check global: Apache deve ter zero linhas em toda tenant table.
  for target in select * from cetec_target_tables
  loop
    execute format(
      'select count(*) from %I.%I where tenant_domain = $1',
      target.schema_name,
      target.table_name
    ) into v_count using v_tenant;

    if v_count <> 0 then
      raise exception 'Pos-check falhou: %.% ainda possui % linha(s) Apache.',
        target.schema_name, target.table_name, v_count;
    end if;
  end loop;
end
$$;

commit;

-- Rollback de dados: cetec_remove_apache_tenant.rollback.sql
