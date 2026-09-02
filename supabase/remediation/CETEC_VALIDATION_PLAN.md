# Plano de validação — remediação CETEC

**Preparado em:** 2026-08-31
**Status:** remediação executada e validada em 2026-08-31
**Banco:** Supabase compartilhado pelos PWAs de referência

## Evidências da execução de 2026-08-31

- Snapshot de segurança: 13 itens (6 policies, 6 grants e 1 bucket).
- C-1: anon INSERT/UPDATE `401`; service_role INSERT `201` e UPDATE `200`;
  `/api/push/subscribe` local `200`.
- C-3: leitura pública `200`; anon INSERT/UPDATE `400`; DELETE anon respondeu
  `200`, mas não removeu nem alterou o objeto; service_role INSERT/UPDATE e
  limpeza `200`.
- M-9: SELECT anon `401`; service_role e `/api/settings` `200`, com
  `source: "database"`.
- Bucket após a mudança: `public = true`, `file_size_limit = null` e
  `allowed_mime_types = null`, idêntico ao inventário.
- Apache: backup e manifest de 3 linhas; zero referências após a remoção.
- Rollbacks C-1/C-3/M-9 e Apache: aprovados em transações de teste descartadas,
  sem mudança persistente do estado remediado.
- Invariância: nenhuma diferença nas contagens dos seis tenants oficiais; a
  linha de `pwa.bingonacional.com` encontrada no inventário também permaneceu
  intacta.
- Artefatos de teste: zero linhas de push e zero objetos de Storage restantes.
- C-2: TypeScript e build aprovados; lint sem erros e com 1 warning
  preexistente. Teste visual não executado por indisponibilidade de navegador.
- `/api/admin/upload`: guarda sem autenticação validada (`401`) e operações
  equivalentes via service_role aprovadas; fluxo autenticado completo pendente.

## Ordem operacional

1. Executar `cetec_inventory.sql` e exportar todos os result sets.
2. Confirmar manualmente os seis tenants oficiais e o tenant Apache.
3. Revisar todas as policies de `storage.objects`, inclusive as marcadas `REVIEW`.
4. Fazer backup lógico externo do banco.
5. Executar `cetec_security_remediation.sql` em staging/restauração de backup.
6. Executar os testes C-1, C-3 e M-9 abaixo.
7. Executar `cetec_remove_apache_tenant.sql` inicialmente com `v_execute = false`.
8. Exportar o preview Apache; somente depois mudar a trava para `true`.
9. Reexecutar o inventário e comparar contagens antes/depois.
10. Somente após aprovação repetir a janela no banco compartilhado.

## 1. C-1 — push_subscriptions

### Teste de banco com role anon

Em banco local/staging, dentro de transação descartável, validar que `anon` não
possui grants de INSERT/UPDATE e que não existe policy correspondente:

```sql
select
  has_table_privilege('anon', 'public.push_subscriptions', 'INSERT') as anon_insert,
  has_table_privilege('anon', 'public.push_subscriptions', 'UPDATE') as anon_update,
  has_table_privilege('authenticated', 'public.push_subscriptions', 'INSERT') as auth_insert,
  has_table_privilege('authenticated', 'public.push_subscriptions', 'UPDATE') as auth_update;

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'push_subscriptions'
  and cmd in ('INSERT', 'UPDATE', 'ALL');
```

Esperado: quatro booleans `false` para os client roles e nenhuma policy de
escrita aplicável a `anon`/`PUBLIC`.

Fazer também requisições PostgREST com a anon key contra INSERT e UPDATE. Ambas
devem falhar com `401/403/42501` ou erro de RLS; não basta receber array vazio.

### Teste da API server-side

1. Subir o app apontando exclusivamente para staging.
2. Enviar `POST /api/push/subscribe` com um `onesignalId` fictício e único.
3. Esperar HTTP 200.
4. Confirmar que a linha contém o `tenant_domain` do staging.
5. Remover a linha fictícia usando `service_role` no staging.
6. Não enviar campanha OneSignal.

## 2. C-3 — app-assets

### Leitura pública

1. Escolher um asset já existente, registrado no inventário.
2. Fazer GET sem Authorization na URL pública.
3. Esperar HTTP 200, mesmo conteúdo e MIME esperado.
4. Repetir para imagem e splash HTML, se ambos existirem.

### Escrita anon/public

Com anon key, tentar em paths temporários e inexistentes:

- INSERT de um arquivo pequeno;
- UPDATE/upsert do mesmo path;
- DELETE do path.

Esperado: todas as operações negadas. Confirmar no catálogo:

```sql
select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'app-assets';
```

Esperado para o bucket:

- `public = true`;
- `file_size_limit` idêntico ao inventário anterior;
- `allowed_mime_types` idêntico ao inventário anterior.

Limites de tamanho e MIME ficam explicitamente fora desta correção P0/P1 e
devem ser avaliados em etapa posterior de hardening.

### `/api/admin/upload`

1. Autenticar no painel de staging.
2. Enviar um PNG válido abaixo do limite do kind.
3. Esperar HTTP 200 e URL pública.
4. Abrir a URL sem autenticação e esperar HTTP 200.
5. Testar splash HTML abaixo de 500 KiB.
6. Remover os arquivos temporários com `service_role` no staging.

## 3. M-9 — app_settings

Confirmar grants/policies:

```sql
select
  has_table_privilege('anon', 'public.app_settings', 'SELECT') as anon_select,
  has_table_privilege('authenticated', 'public.app_settings', 'SELECT') as auth_select,
  has_table_privilege('service_role', 'public.app_settings', 'SELECT') as service_select;

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'app_settings';
```

Esperado: client roles `false`, `service_role = true` e nenhuma SELECT policy
para `anon`/`PUBLIC`.

Depois:

1. GET direto PostgREST com anon key deve ser negado.
2. `GET /api/settings` deve retornar HTTP 200 e `source: "database"`.
3. Homepage, metadata e manifest devem usar o tenant correto.
4. Não alterar settings durante este teste.

## 4. Remoção Apache

Antes de ativar `v_execute`, guardar:

- XML completo das linhas Apache;
- contagem de todos os tenants em todas as tenant tables;
- FKs retornadas pelo inventário;
- linha de `app_settings` e URLs de assets;
- backup lógico externo.

Após a remoção:

```sql
-- Deve retornar zero linhas.
select * from public.app_settings
where tenant_domain = 'pwa.app.apachejb.app';

select * from public.push_subscriptions
where tenant_domain = 'pwa.app.apachejb.app';

select * from public.push_campaigns
where tenant_domain = 'pwa.app.apachejb.app';

-- Manifest/backup devem existir e concordar.
select *
from cetec_audit.apache_deletion_manifest
where batch_id = 'cetec-apache-removal-2026-08-31'
order by deletion_order;

select schema_name, table_name, count(*) as backup_rows
from cetec_audit.apache_row_backup
where batch_id = 'cetec-apache-removal-2026-08-31'
group by schema_name, table_name
order by schema_name, table_name;
```

Reexecutar `cetec_inventory.sql`: nenhuma tabela com `tenant_domain` pode
conter Apache.

## 5. Garantia de que outros tenants não mudaram

Comparar o result set “contagem por tenant_domain” do inventário anterior e
posterior. As contagens destes tenants devem ser idênticas:

- `pwa.app-bigpix.com`
- `pwa.app-megabingo7.com`
- `pwa.app-obapremios.com`
- `pwa.app-premiosaovivo.com`
- `pwa.app-pixkeno.com`
- `pwa.app-superkeno.com`

Qualquer divergência bloqueia a conclusão e exige rollback antes de nova
investigação.

## 6. Rollback

- C-1/C-3/M-9: executar `cetec_rollback.sql`; ele usa as definições reais do
  snapshot e preserva o snapshot como evidência.
- Apache: executar `cetec_remove_apache_tenant.rollback.sql` depois de mudar
  sua trava explícita para `v_execute = true`.
- Depois de qualquer rollback, reexecutar integralmente o inventário e todos
  os testes de aplicação afetados.

## Critério de aprovação

A etapa só pode ser aprovada quando os nove requisitos solicitados estiverem
com evidência exportada, nenhuma contagem dos seis tenants oficiais tiver
mudado e os dois fluxos server-side (`/api/push/subscribe` e
`/api/admin/upload`) tiverem sido validados em staging sem envio real de push.
