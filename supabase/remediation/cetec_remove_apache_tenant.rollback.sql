-- CETEC - rollback da remocao do tenant Apache
-- Tenant: pwa.app.apachejb.app
-- Data de preparacao: 2026-08-31
-- STATUS: PREPARADO, DESATIVADO E NAO EXECUTADO
--
-- Restaura as linhas preservadas em cetec_audit.apache_row_backup.
-- Pais sao restaurados antes dos filhos (ordem inversa do DELETE).

begin;

select pg_advisory_xact_lock(hashtextextended('cetec-remove-apache-tenant-2026-08-31', 0));

do $$
declare
  -- TRAVA OPERACIONAL: mudar para true somente para rollback aprovado.
  v_execute constant boolean := false;
  v_tenant constant text := 'pwa.app.apachejb.app';
  v_batch constant text := 'cetec-apache-removal-2026-08-31';
  manifest_row record;
  v_existing bigint;
  v_restored bigint;
  v_columns text;
  v_rows jsonb;
begin
  if not v_execute then
    raise exception
      'ROLLBACK APACHE DESATIVADO: altere v_execute para true somente na janela aprovada.';
  end if;

  if to_regclass('cetec_audit.apache_row_backup') is null
    or to_regclass('cetec_audit.apache_deletion_manifest') is null then
    raise exception 'Rollback abortado: tabelas de backup/manifest ausentes.';
  end if;

  if not exists (
    select 1 from cetec_audit.apache_deletion_manifest where batch_id = v_batch
  ) then
    raise exception 'Rollback abortado: manifest do batch % ausente.', v_batch;
  end if;

  -- Nao mistura backup com linhas Apache recriadas depois da remocao.
  for manifest_row in
    select *
    from cetec_audit.apache_deletion_manifest
    where batch_id = v_batch
    order by deletion_order desc
  loop
    if to_regclass(format('%I.%I', manifest_row.schema_name, manifest_row.table_name)) is null then
      raise exception 'Rollback abortado: tabela %.% nao existe mais.',
        manifest_row.schema_name, manifest_row.table_name;
    end if;

    execute format(
      'select count(*) from %I.%I where tenant_domain = $1',
      manifest_row.schema_name,
      manifest_row.table_name
    ) into v_existing using v_tenant;

    if v_existing <> 0 then
      raise exception
        'Rollback abortado: %.% ja possui % linha(s) do Apache.',
        manifest_row.schema_name, manifest_row.table_name, v_existing;
    end if;
  end loop;

  -- Ordem inversa do DELETE: pais primeiro, filhos depois.
  for manifest_row in
    select *
    from cetec_audit.apache_deletion_manifest
    where batch_id = v_batch
    order by deletion_order desc
  loop
    if manifest_row.row_count = 0 then
      continue;
    end if;

    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
    where a.attrelid = to_regclass(
      format('%I.%I', manifest_row.schema_name, manifest_row.table_name)
    )
      and a.attnum > 0
      and not a.attisdropped
      and a.attgenerated = '';

    if v_columns is null then
      raise exception 'Rollback abortado: nenhuma coluna restauravel em %.%.',
        manifest_row.schema_name, manifest_row.table_name;
    end if;

    select jsonb_agg(row_data order by row_hash)
    into v_rows
    from cetec_audit.apache_row_backup
    where batch_id = v_batch
      and schema_name = manifest_row.schema_name
      and table_name = manifest_row.table_name;

    if coalesce(jsonb_array_length(v_rows), 0) <> manifest_row.row_count then
      raise exception
        'Rollback abortado: backup divergente em %.% (manifest %, backup %).',
        manifest_row.schema_name,
        manifest_row.table_name,
        manifest_row.row_count,
        coalesce(jsonb_array_length(v_rows), 0);
    end if;

    execute format(
      'insert into %I.%I (%s) overriding system value '
      || 'select %s from jsonb_populate_recordset(null::%I.%I, $1)',
      manifest_row.schema_name,
      manifest_row.table_name,
      v_columns,
      v_columns,
      manifest_row.schema_name,
      manifest_row.table_name
    ) using v_rows;

    get diagnostics v_restored = row_count;

    if v_restored <> manifest_row.row_count then
      raise exception
        'Rollback divergente em %.%: esperado %, restaurado %.',
        manifest_row.schema_name,
        manifest_row.table_name,
        manifest_row.row_count,
        v_restored;
    end if;
  end loop;

  -- Pos-check final por tabela.
  for manifest_row in
    select *
    from cetec_audit.apache_deletion_manifest
    where batch_id = v_batch
  loop
    execute format(
      'select count(*) from %I.%I where tenant_domain = $1',
      manifest_row.schema_name,
      manifest_row.table_name
    ) into v_existing using v_tenant;

    if v_existing <> manifest_row.row_count then
      raise exception
        'Pos-check falhou em %.%: esperado %, encontrado %.',
        manifest_row.schema_name,
        manifest_row.table_name,
        manifest_row.row_count,
        v_existing;
    end if;
  end loop;
end
$$;

commit;

-- Backup e manifest permanecem em cetec_audit como evidencia.
