-- CETEC - rollback completo de C-1, C-3 e M-9
-- Data de preparacao: 2026-08-31
-- STATUS: PREPARADO, NAO EXECUTADO
--
-- Recria policies pelos nomes/expressoes/roles REAIS capturados durante a
-- remediacao, restaura apenas os grants removidos e devolve a configuracao
-- anterior do bucket app-assets.
--
-- NAO executar se cetec_security_remediation.sql nao tiver concluido com
-- sucesso e o snapshot cetec-security-2026-08-31 nao estiver presente.

begin;

select pg_advisory_xact_lock(hashtextextended('cetec-security-remediation-2026-08-31', 0));

do $$
begin
  if to_regclass('cetec_audit.security_snapshot') is null then
    raise exception 'Rollback abortado: cetec_audit.security_snapshot nao existe.';
  end if;

  if not exists (
    select 1
    from cetec_audit.security_snapshot
    where batch_id = 'cetec-security-2026-08-31'
  ) then
    raise exception 'Rollback abortado: snapshot cetec-security-2026-08-31 ausente.';
  end if;

  if exists (
    select 1
    from cetec_audit.security_snapshot s
    join pg_policies p
      on p.schemaname = s.schema_name
     and p.tablename = s.table_name
     and p.policyname = s.object_name
    where s.batch_id = 'cetec-security-2026-08-31'
      and s.object_type = 'policy'
  ) then
    raise exception 'Rollback abortado: policy do snapshot ja existe; revisar conflito manualmente.';
  end if;
end
$$;

-- 1. Recriar policies exatamente como capturadas.
do $$
declare
  s record;
  roles_sql text;
  statement_sql text;
  cmd text;
  permissive_mode text;
begin
  for s in
    select *
    from cetec_audit.security_snapshot
    where batch_id = 'cetec-security-2026-08-31'
      and object_type = 'policy'
    order by schema_name, table_name, object_name
  loop
    cmd := upper(s.definition ->> 'cmd');
    permissive_mode := upper(s.definition ->> 'permissive');

    if cmd not in ('ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE') then
      raise exception 'Comando de policy invalido no snapshot: %', cmd;
    end if;

    if permissive_mode not in ('PERMISSIVE', 'RESTRICTIVE') then
      raise exception 'Modo de policy invalido no snapshot: %', permissive_mode;
    end if;

    select string_agg(
      case when role_name = 'public' then 'public' else quote_ident(role_name) end,
      ', '
      order by role_name
    )
    into roles_sql
    from jsonb_array_elements_text(s.definition -> 'roles') as role_rows(role_name);

    if roles_sql is null then
      raise exception 'Policy % sem roles no snapshot.', s.object_name;
    end if;

    statement_sql := format(
      'create policy %I on %I.%I as %s for %s to %s',
      s.object_name,
      s.schema_name,
      s.table_name,
      permissive_mode,
      cmd,
      roles_sql
    );

    if s.definition ->> 'qual' is not null then
      statement_sql := statement_sql || format(' using (%s)', s.definition ->> 'qual');
    end if;

    if s.definition ->> 'with_check' is not null then
      statement_sql := statement_sql || format(' with check (%s)', s.definition ->> 'with_check');
    end if;

    execute statement_sql;
  end loop;
end
$$;

-- 2. Restaurar somente grants que existiam antes da remediacao.
do $$
declare
  s record;
  grantee_sql text;
  privilege_name text;
  grant_option_sql text;
begin
  for s in
    select *
    from cetec_audit.security_snapshot
    where batch_id = 'cetec-security-2026-08-31'
      and object_type = 'grant'
    order by schema_name, table_name, object_name
  loop
    privilege_name := upper(s.definition ->> 'privilege_type');

    if privilege_name not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE') then
      raise exception 'Privilegio invalido no snapshot: %', privilege_name;
    end if;

    grantee_sql := case
      when lower(s.definition ->> 'grantee') = 'public' then 'public'
      else quote_ident(s.definition ->> 'grantee')
    end;

    grant_option_sql := case
      when coalesce((s.definition ->> 'is_grantable')::boolean, false)
        then ' with grant option'
      else ''
    end;

    execute format(
      'grant %s on table %I.%I to %s%s',
      privilege_name,
      s.schema_name,
      s.table_name,
      grantee_sql,
      grant_option_sql
    );
  end loop;
end
$$;

-- 3. Restaurar configuracao exata do bucket.
do $$
declare
  bucket_snapshot jsonb;
  mime_types text[];
begin
  select definition
  into bucket_snapshot
  from cetec_audit.security_snapshot
  where batch_id = 'cetec-security-2026-08-31'
    and object_type = 'bucket'
    and schema_name = 'storage'
    and table_name = 'buckets'
    and object_name = 'app-assets';

  if bucket_snapshot is null then
    raise exception 'Rollback abortado: snapshot do bucket app-assets ausente.';
  end if;

  if jsonb_typeof(bucket_snapshot -> 'allowed_mime_types') = 'array' then
    select array_agg(value order by ordinality)
    into mime_types
    from jsonb_array_elements_text(bucket_snapshot -> 'allowed_mime_types')
      with ordinality as mime(value, ordinality);
  else
    mime_types := null;
  end if;

  update storage.buckets
  set
    name = bucket_snapshot ->> 'name',
    public = (bucket_snapshot ->> 'public')::boolean,
    file_size_limit = (bucket_snapshot ->> 'file_size_limit')::bigint,
    allowed_mime_types = mime_types
  where id = bucket_snapshot ->> 'id';

  if not found then
    raise exception 'Rollback abortado: bucket app-assets nao encontrado.';
  end if;
end
$$;

-- 4. Pos-check: todas as policies do snapshot voltaram.
do $$
begin
  if exists (
    select 1
    from cetec_audit.security_snapshot s
    where s.batch_id = 'cetec-security-2026-08-31'
      and s.object_type = 'policy'
      and not exists (
        select 1
        from pg_policies p
        where p.schemaname = s.schema_name
          and p.tablename = s.table_name
          and p.policyname = s.object_name
      )
  ) then
    raise exception 'Pos-check do rollback falhou: policy nao restaurada.';
  end if;
end
$$;

commit;

-- O schema cetec_audit e o snapshot sao preservados como evidencia.
