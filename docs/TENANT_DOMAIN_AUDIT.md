# TENANT_DOMAIN_AUDIT.md

# Auditoria: Implementação de tenant_domain

**Projeto:** app-big-pwa  
**Data:** 2026-06-28  
**Objetivo:** validar completamente a implementação de `tenant_domain` introduzida pelo merge dos 5 commits remotos antes de iniciar qualquer desenvolvimento.  
**Escopo:** análise estática inicial — nenhum arquivo foi alterado durante a auditoria.  
**Atualizado em:** 2026-06-28 — decisão arquitetural registrada; migration planejada.

---

## 1. Contexto

Em 2026-06-28, foi executado `git merge origin/main` trazendo 5 commits que implementaram a feature `tenant_domain` como mecanismo de identificação de settings por domínio.

Antes do merge, o projeto usava `singleton_key boolean unique` para garantir uma única linha na tabela `app_settings`. Após o merge, o código passou a filtrar por `.eq("tenant_domain", hostname)` e a salvar com `.upsert({ onConflict: "tenant_domain" })`.

---

## 2. Resposta objetiva às 9 perguntas da auditoria

### P1. A coluna `tenant_domain` existe no `supabase/schema.sql`?

**Não.**

O arquivo `supabase/schema.sql` não contém a coluna `tenant_domain`. A definição atual da tabela é:

```sql
create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  singleton_key boolean not null default true unique,
  app_name text,
  ...
);
```

Não há nenhum `ALTER TABLE ... ADD COLUMN ... tenant_domain` no arquivo.

---

### P2. Existe constraint UNIQUE em `tenant_domain` no schema?

**Não.**

O código em `app/api/admin/settings/route.ts` executa:

```typescript
supabase
  .from("app_settings")
  .upsert({ ...row, tenant_domain: hostname }, { onConflict: "tenant_domain" })
```

O `onConflict: "tenant_domain"` do Supabase é traduzido para `ON CONFLICT (tenant_domain)` no Postgres. Sem uma constraint `UNIQUE` ou índice único nessa coluna, essa instrução falha com erro de banco.

**Esta operação está quebrada em produção.**

---

### P3. O código usa `tenant_domain` em todas as operações de leitura?

**Sim, em 3 arquivos.**

| Arquivo | Operação | Linha |
|---|---|---|
| `lib/app-settings.server.ts` | SELECT `.eq("tenant_domain", hostname)` | 21 |
| `app/api/settings/route.ts` | SELECT `.eq("tenant_domain", hostname)` | 25 |
| `app/api/admin/settings/route.ts` | UPDATE `.eq("tenant_domain", hostname)` | 96 |

---

### P4. O código usa `tenant_domain` em todas as operações de escrita?

**Sim.**

Em `app/api/admin/settings/route.ts`:

- **UPDATE** (quando `settings.id` existe): `.update(row).eq("tenant_domain", hostname)` — filtra pelo hostname.
- **UPSERT** (quando não há `id`): `.upsert({ ...row, tenant_domain: hostname }, { onConflict: "tenant_domain" })` — requer UNIQUE constraint.

---

### P5. Existe algum uso residual do padrão antigo (`singleton_key`, `.order("updated_at")`, `.limit(1)`)?

**Apenas no schema.sql.**

| Padrão | Resultado |
|---|---|
| `singleton_key` | Encontrado apenas em `supabase/schema.sql` (linhas 30, 60, 101) e `docs/AUDIT_REPORT.md` (texto descritivo). Zero uso em código TypeScript/rotas. |
| `.order("updated_at")` | Não encontrado em nenhum arquivo TypeScript. Completamente removido. |
| `.limit(1)` | Não encontrado para `app_settings`. Existe em `app/api/push/send/route.ts` (linha 86), mas referente à tabela `push_subscriptions`, não a `app_settings`. |

O código de aplicação foi completamente migrado para `tenant_domain`. Somente o schema não acompanhou.

---

### P6. Quais arquivos foram modificados para implementar `tenant_domain`?

**4 arquivos de código modificados. 0 arquivos de schema modificados.**

| Arquivo | Modificação |
|---|---|
| `lib/app-settings.ts` | `AppSettings.tenantDomain?: string` adicionado; `AppSettingsRow.tenant_domain?: string \| null` adicionado; `extractHostname(url)` criada; `getFallbackAppSettings()`, `settingsRowToAppSettings()`, `appSettingsToRow()` atualizados |
| `lib/app-settings.server.ts` | `getAppSettings()` trocou `.order("updated_at").limit(1)` por `.eq("tenant_domain", hostname)`. Logs com prefixo `[app-settings]` adicionados |
| `app/api/settings/route.ts` | SELECT por `.eq("tenant_domain", hostname)`. Logs com prefixo `[api/settings]` adicionados |
| `app/api/admin/settings/route.ts` | UPDATE e UPSERT por `tenant_domain`. `SettingsPayload.tenantDomain` adicionado |

---

### P7. Quais arquivos NÃO foram afetados pela mudança?

| Arquivo | Motivo |
|---|---|
| `app/api/push/subscribe/route.ts` | Apenas `push_subscriptions`, sem `app_settings` |
| `app/api/push/send/route.ts` | Chama `getAppSettings()` indiretamente — impactado via chain, mas sem referência direta a `tenant_domain` |
| `app/api/admin/upload/route.ts` | Apenas Supabase Storage, sem `app_settings` |
| `components/onesignal-initializer.tsx` | Usa `NEXT_PUBLIC_ONESIGNAL_APP_ID` (env var), sem banco |
| `app/page.tsx` | Chama `/api/settings` (impactado indiretamente), sem `tenant_domain` direto |
| `app/manifest.ts` | Chama `getAppSettings()` indiretamente — impactado via chain |
| `supabase/schema.sql` | **NÃO FOI MODIFICADO** — este é o gap crítico |

---

### P8. A lógica de `extractHostname()` está correta?

**Sim, com ressalva.**

A implementação:

```typescript
export function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
```

- Para `NEXT_PUBLIC_PUBLIC_URL = "https://app.exemplo.com"` → retorna `"app.exemplo.com"`. Correto.
- Para `NEXT_PUBLIC_PUBLIC_URL = "https://app.exemplo.com/path"` → retorna `"app.exemplo.com"`. Correto (ignora path).
- Para uma string inválida (ex: `""` ou `"#"`) → a exceção é capturada e retorna a string original. Neste caso, o fallback retorna `""` ou `"#"`, que nunca vai bater com nenhum registro no banco.
- Para `NEXT_PUBLIC_PUBLIC_URL` não configurado (undefined/empty) → retorna string vazia. O `.eq("tenant_domain", "")` não encontra registro e o sistema cai para fallback silencioso.

**Ressalva:** se `NEXT_PUBLIC_PUBLIC_URL` não estiver configurado, o sistema opera integralmente em fallback de env vars sem log de erro visível ao operador.

---

### P9. Diagnóstico geral: o sistema está funcional com a implementação atual?

**Não. O sistema está em estado de falha silenciosa.**

Diagrama do fluxo atual em produção:

```
Request → getAppSettings()
  → extractHostname(NEXT_PUBLIC_PUBLIC_URL) = "app.cliente.com"
  → SELECT * FROM app_settings WHERE tenant_domain = 'app.cliente.com'
  → 0 rows (coluna não existe ou registro não foi migrado)
  → console.warn: "nenhum registro encontrado para tenant_domain: app.cliente.com"
  → retorna getFallbackAppSettings() — dados do env, não do banco
```

O admin pode salvar no banco, mas:

```
POST /api/admin/settings
  → UPSERT { tenant_domain: 'app.cliente.com', onConflict: 'tenant_domain' }
  → Postgres error: "there is no unique or exclusion constraint matching the ON CONFLICT specification"
  → HTTP 500: "Nao foi possivel salvar as configuracoes."
```

O painel admin está quebrado para salvar settings.

---

## 3. Inventário completo de ocorrências de `tenant_domain`

### 3.1 Código de aplicação (pós-merge)

| Arquivo | Linha | Ocorrência |
|---|---|---|
| `lib/app-settings.ts` | 5 | `tenantDomain?: string` em `AppSettings` |
| `lib/app-settings.ts` | 30 | `tenant_domain?: string \| null` em `AppSettingsRow` |
| `lib/app-settings.ts` | 68 | `tenantDomain: extractHostname(appConfig.publicUrl)` em `getFallbackAppSettings()` |
| `lib/app-settings.ts` | 115 | `tenantDomain: row.tenant_domain \|\| fallback.tenantDomain` em `settingsRowToAppSettings()` |
| `lib/app-settings.ts` | 150 | `tenant_domain: settings.tenantDomain` em `appSettingsToRow()` |
| `lib/app-settings.server.ts` | 15 | `extractHostname(appConfig.publicUrl)` |
| `lib/app-settings.server.ts` | 16 | `console.log("[app-settings] buscando tenant_domain:", hostname)` |
| `lib/app-settings.server.ts` | 21 | `.eq("tenant_domain", hostname)` |
| `lib/app-settings.server.ts` | 25 | `console.error("[app-settings] erro ao buscar tenant_domain:", ...)` |
| `lib/app-settings.server.ts` | 30 | `console.warn("[app-settings] nenhum registro encontrado para tenant_domain:", ...)` |
| `app/api/settings/route.ts` | 19 | `extractHostname(appConfig.publicUrl)` |
| `app/api/settings/route.ts` | 20 | `console.log("[api/settings] buscando tenant_domain:", hostname)` |
| `app/api/settings/route.ts` | 25 | `.eq("tenant_domain", hostname)` |
| `app/api/admin/settings/route.ts` | 9 | `tenantDomain?: string` em `SettingsPayload` |
| `app/api/admin/settings/route.ts` | 92 | `extractHostname(appConfig.publicUrl)` |
| `app/api/admin/settings/route.ts` | 96 | `.update(row).eq("tenant_domain", hostname)` |
| `app/api/admin/settings/route.ts` | 99 | `.upsert({ ...row, tenant_domain: hostname }, { onConflict: "tenant_domain" })` |

### 3.2 Schema (pré-merge, sem atualização)

Nenhuma ocorrência de `tenant_domain` em `supabase/schema.sql`.

### 3.3 Documentação (desatualizada após merge — corrigida em 2026-06-28)

Os arquivos abaixo estavam desatualizados no momento da auditoria. Foram corrigidos na mesma data.

| Arquivo | Status |
|---|---|
| `AGENTS.md` | Corrigido — seção "Arquitetura atual" atualizada para transição |
| `CLAUDE.md` | Corrigido — idem |
| `docs/AUDIT_REPORT.md` | Corrigido — seções 1 e 3 atualizadas |
| `docs/FIRST_DELIVERY_PLAN.md` | Corrigido — Etapa 0 adicionada; linha de escopo excluído atualizada |

---

## 4. Gaps e riscos

### 4.1 CRÍTICO — Schema sem coluna `tenant_domain`

**Gap:** `supabase/schema.sql` não tem a coluna `tenant_domain`.

**Impacto:**
- Todos os SELECTs por `tenant_domain` retornam 0 rows → settings sempre em fallback de env vars.
- O UPSERT com `onConflict: "tenant_domain"` falha com erro Postgres se a coluna existir mas sem constraint, ou com erro de coluna inexistente se não existir.
- O painel admin não consegue salvar configurações.

**Migration planejada:** `supabase/migrations/002_add_tenant_domain_to_app_settings.sql`

```sql
alter table public.app_settings
  add column if not exists tenant_domain text;

create unique index if not exists app_settings_tenant_domain_key
  on public.app_settings (tenant_domain);

-- UPDATE public.app_settings
-- SET    tenant_domain = 'SUBSTITUIR_PELO_DOMINIO_DO_CLIENTE'
-- WHERE  tenant_domain IS NULL;
```

**Nota técnica:** o índice não é parcial (`WITHOUT WHERE`). O Postgres permite múltiplas linhas com `tenant_domain = NULL` em índices únicos porque `NULL != NULL` por padrão. Um índice parcial (`WHERE IS NOT NULL`) não seria compatível com `ON CONFLICT (tenant_domain)` sem predicado no UPSERT.

**Status:** migration criada, aguardando execução com aprovação e backup prévio.

---

### 4.2 CRÍTICO — Linha seed incompatível com novo código

O schema atual seed insere:

```sql
insert into public.app_settings (singleton_key, app_name, ...)
values (true, 'App Big', ...)
on conflict (singleton_key) do nothing;
```

Essa linha tem `tenant_domain = NULL`. Ela nunca será encontrada pelos novos SELECTs.

**Para um deploy existente:** é necessário executar manualmente:

```sql
update public.app_settings
set tenant_domain = 'hostname.do.deploy.aqui'
where tenant_domain is null;
```

Para um deploy novo: o seed não insere `tenant_domain`, então a linha seed também ficará com NULL e nunca será encontrada.

---

### 4.3 ALTO — Documentação factualmente errada

4 arquivos de documentação (incluindo `AGENTS.md` e `CLAUDE.md`, que são as instruções permanentes para agentes de IA) afirmam que `tenant_domain` não existe. Isso pode causar decisões incorretas de agentes ou desenvolvedores.

**Arquivos que precisam ser atualizados:**
- `AGENTS.md`
- `CLAUDE.md`
- `docs/AUDIT_REPORT.md`
- `docs/FIRST_DELIVERY_PLAN.md`

---

### 4.4 MÉDIO — Split do OneSignal App ID (risco pré-existente, não agravado)

| Ponto | Fonte |
|---|---|
| Inicialização do SDK no cliente | `NEXT_PUBLIC_ONESIGNAL_APP_ID` (variável de ambiente, build-time) |
| Envio de push no servidor | `settings.oneSignalAppId` via `getAppSettings()` → banco via `tenant_domain` |

Se `tenant_domain` não for migrado, `getAppSettings()` retornará fallback de env vars. Isso significa que o envio de push também lerá `NEXT_PUBLIC_ONESIGNAL_APP_ID` via `appConfig`. Nesse cenário os dois lados coincidem acidentalmente — mas é um acidente, não uma garantia.

Uma vez que `tenant_domain` esteja corretamente migrado e o admin configure um `onesignal_app_id` diferente no banco, o split voltará a ser um risco real: SDK cliente usa env var, servidor usa banco.

---

### 4.5 BAIXO — Fallback silencioso sem log de erro visível para operador

Quando `tenant_domain` não encontra registro (`console.warn`), o sistema retorna fallback de env vars sem qualquer indicação visível ao operador no painel admin. A origem dos dados (`source: "database"` vs `source: "env"`) é retornada em `app/api/settings/route.ts`, mas não há evidência de que o painel admin exiba essa informação.

---

## 5. Impacto por arquivo em produção hoje

| Arquivo | Situação | Impacto |
|---|---|---|
| `lib/app-settings.server.ts` | Quebrado (runtime) | `getAppSettings()` retorna fallback, nunca retorna dados do banco |
| `app/api/settings/route.ts` | Degradado | Retorna `source: "env"` sempre; settings do banco nunca aparecem |
| `app/api/admin/settings/route.ts` | Quebrado (runtime) | UPSERT falha com erro Postgres; UPDATE também não encontra linha |
| `app/manifest.ts` | Degradado | Usa fallback de env vars, não dados do banco |
| `app/page.tsx` | Degradado | Exibe dados de env vars, não do banco |
| `app/api/push/send/route.ts` | Degradado indiretamente | `settings.oneSignalAppId` vem de env var, não do banco |
| `app/api/push/subscribe/route.ts` | OK | Independente de `app_settings` |
| `app/api/admin/upload/route.ts` | OK | Independente de `app_settings` |
| `components/onesignal-initializer.tsx` | OK | Independente de banco |

---

## 6. Ações necessárias antes de qualquer desenvolvimento

As ações abaixo estão ordenadas por dependência. Nenhuma deve ser executada sem aprovação explícita.

### Ação 1 — Executar migration do schema (bloqueante para tudo)

**Arquivo:** `supabase/migrations/002_add_tenant_domain_to_app_settings.sql`

Pré-requisitos antes de executar:
- Fazer backup completo do banco Supabase.
- Identificar o hostname exato do deploy (valor de `NEXT_PUBLIC_PUBLIC_URL` no Vercel).
- Descomentar e preencher o bloco UPDATE na migration com o hostname real.
- Executar em homologação primeiro, se disponível.

A migration é idempotente nos passos de estrutura (ADD COLUMN IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS). O UPDATE manual precisa ser descomentado e preenchido.

### Ação 2 — Verificar funcionamento após migration

Após a migration, validar:
- `GET /api/settings` retorna `source: "database"` (não `source: "env"`).
- Painel admin consegue salvar configurações sem erro 500.
- Manifesto e splash exibem dados do banco, não do env.

### Ação 3 — Documentação (concluída em 2026-06-28)

`AGENTS.md`, `CLAUDE.md`, `docs/AUDIT_REPORT.md` e `docs/FIRST_DELIVERY_PLAN.md` foram corrigidos na mesma data da auditoria.

### Ação 4 — Atualizar seed no schema.sql para novos deploys (planejamento futuro)

O seed atual usa `on conflict (singleton_key) do nothing`. Para novos deploys, o processo de onboarding precisa incluir o UPDATE manual de `tenant_domain` após aplicar o seed.

### Rollback disponível

**Arquivo:** `supabase/migrations/002_add_tenant_domain_to_app_settings.rollback.sql`

Remove o índice e a coluna. O sistema volta ao estado anterior (falha silenciosa em runtime). Usar somente se a migration causar problema inesperado.

---

## 7. Resumo executivo

| Pergunta | Resposta |
|---|---|
| `tenant_domain` existe no schema? | **Não — migration planejada, pendente de execução** |
| Constraint UNIQUE existe? | **Não — incluída na migration** |
| Código lê por `tenant_domain`? | **Sim — 3 arquivos** |
| Código escreve por `tenant_domain`? | **Sim — 1 arquivo (UPSERT quebrado até migration)** |
| Padrão antigo (`singleton_key`) ainda existe no código? | **Não — apenas no schema (mantido como legado)** |
| `.order("updated_at").limit(1)` ainda existe? | **Não — completamente removido** |
| Documentação está atualizada? | **Sim — corrigida em 2026-06-28** |
| Sistema funciona em produção hoje? | **Não — settings em fallback até migration** |
| Painel admin consegue salvar? | **Não — UPSERT falha até migration** |
| O que desbloqueia tudo? | **Executar `002_add_tenant_domain_to_app_settings.sql` com backup e aprovação** |

---

## 8. Decisão arquitetural e migration planejada

### Decisão aprovada

**Banco único compartilhado com isolamento por `tenant_domain`.**

Cada deploy Vercel do projeto compartilha o mesmo banco Supabase. O isolamento entre clientes é feito pelo campo `tenant_domain` na tabela `app_settings`, cujo valor é o hostname de `NEXT_PUBLIC_PUBLIC_URL`.

Esta decisão foi aprovada em 2026-06-28 após a auditoria.

### Por que não continuar com singleton_key

O código pós-merge já opera com `tenant_domain`. Reverter para `singleton_key` exigiria modificar 4 arquivos TypeScript de aplicação, o que é mais invasivo e arriscado do que aplicar a migration de schema planejada.

### Migration criada

**Arquivo:** `supabase/migrations/002_add_tenant_domain_to_app_settings.sql`

O que faz:
1. Adiciona coluna `tenant_domain text` em `app_settings` (idempotente).
2. Cria índice único em `tenant_domain` — necessário para `ON CONFLICT (tenant_domain)` (idempotente).
3. Bloco UPDATE comentado: deve ser descomentado e preenchido com o hostname real antes de executar.

O que preserva:
- Dados existentes em `app_settings` não são apagados.
- `singleton_key` permanece intocado (legado, sem uso no código).
- A migration é idempotente nos passos de estrutura.

### Rollback disponível

**Arquivo:** `supabase/migrations/002_add_tenant_domain_to_app_settings.rollback.sql`

Remove índice e coluna. O sistema volta ao estado de falha silenciosa anterior.

### Riscos da migration

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Linha existente não atualizada (UPDATE não descomentado) | Alta | Validar `GET /api/settings` após migration — deve retornar `source: database` |
| Hostname errado no UPDATE | Média | Confirmar exatamente `new URL(NEXT_PUBLIC_PUBLIC_URL).hostname` antes de executar |
| Banco sem backup antes da migration | Alta | **Obrigatório fazer backup antes de executar qualquer migration** |
| Conflito se já existir linha com mesmo tenant_domain | Baixa | O índice único criado na migration já previne duplicatas futuras |

### Próximo passo

Executar `002_add_tenant_domain_to_app_settings.sql` no Supabase Studio (SQL Editor) após:
1. Backup do banco.
2. Preenchimento do placeholder `SUBSTITUIR_PELO_DOMINIO_DO_CLIENTE`.
3. Aprovação do responsável técnico.
