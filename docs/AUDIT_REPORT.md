# AUDIT_REPORT.md

# Auditoria Técnica — PWA White Label

**Projeto:** app-big-pwa  
**Base analisada:** AUDIT_SNAPSHOT.md  
**Data:** 2026-06-28  
**Objetivo:** identificar riscos, inconsistências e próximos passos sem alterar produção.

---

## 1. Resumo Executivo

**Atualização 2026-07-02:** o bloqueio crítico descrito abaixo foi resolvido. Leitura
direta do banco compartilhado confirmou que a migration `002` já foi executada — a
coluna `tenant_domain` existe e as 4 linhas de `app_settings` (Big Pix, MegaBingo7,
Oba Prêmios, Prêmios ao Vivo) já estão isoladas corretamente por domínio. O texto
original da auditoria (2026-06-28) é mantido abaixo como registro histórico do
diagnóstico que levou à decisão arquitetural da seção 8.

O projeto **operava** em transição arquitetural com um bloqueio crítico em produção.

O código foi atualizado para operar como multi-tenant por domínio (`tenant_domain`), mas o banco de dados ainda não acompanhava. Isso criava um estado de falha silenciosa em produção.

> **Modelo anterior:** White label por deploy individual — settings identificados por `singleton_key boolean unique` (coluna legada, mantida sem uso no código).

> **Modelo atual (código e banco, confirmado em 2026-07-02):** Multi-tenant por domínio — settings identificados por `tenant_domain`, banco único compartilhado pelos 4 PWAs ativos.

> **Gap crítico (histórico, já resolvido):** a coluna `tenant_domain` não existia em `supabase/schema.sql` nem no banco. Leitura sempre retornava fallback de env vars. Escrita falhava com erro Postgres. **`supabase/schema.sql` ainda não foi atualizado para refletir a coluna** — pendência de baixo risco, não bloqueante, já que o banco de produção já tem a coluna aplicada via migration.

> **Atualização 2026-07-04:** o projeto já opera com **6 tenants ativos** no mesmo banco compartilhado (Big Pix, MegaBingo7, Oba Prêmios, Prêmios ao Vivo, Pix Keno, SuperKeno — ver `docs/TENANT_DOMAIN_AUDIT.md`), e o risco de push sem isolamento por tenant (seção 4.4) — que se tornou real assim que OneSignal foi habilitado nos 6 — foi resolvido pela migration `004_add_tenant_isolation_to_push_tables.sql`, validada em produção. Ver seção 4.4 para o registro completo.

Para a auditoria completa da implementação, status atual e ações necessárias, ler: `docs/TENANT_DOMAIN_AUDIT.md`.

---

## 2. Pontos Fortes

- Stack moderna com Next.js App Router, TypeScript, Tailwind, Supabase e Vercel.
- Painel admin já centraliza boa parte das configurações visuais.
- Upload de assets já existe via Supabase Storage.
- Push notification já possui estrutura inicial com OneSignal.
- Manifest PWA é dinâmico.
- Existe separação razoável entre settings, admin, upload e push.
- O projeto já possui um snapshot técnico útil para manutenção.

---

## 3. Diagnóstico Principal

### Situação anterior (pré-merge)

O projeto operava como white label por deploy individual. Settings identificados por `singleton_key boolean unique`. A documentação original afirmava que `tenant_domain` não existia.

### Situação atual (pós-merge de 2026-06-28)

Após o merge de 5 commits remotos, o código foi atualizado para:

- filtrar `app_settings` por `.eq("tenant_domain", hostname)`;
- salvar settings com `.upsert({ onConflict: "tenant_domain" })`;
- derivar o hostname de `NEXT_PUBLIC_PUBLIC_URL` via `extractHostname()`.

Porém, `supabase/schema.sql` (o arquivo de schema base do repositório) **não foi atualizado** — a coluna foi adicionada em produção somente pela execução direta da migration `002` no banco, confirmada em 2026-07-02.

Consequência histórica (antes da migration rodar):

- Todas as leituras retornavam `0 rows` → sistema usava fallback de env vars.
- O UPSERT falhava com erro Postgres por falta de constraint UNIQUE.
- O painel admin não conseguia salvar configurações.

**Situação atual (2026-07-02):** a migration já foi executada. As 4 linhas de `app_settings` têm `tenant_domain` preenchido corretamente. O índice único em `tenant_domain` foi confirmado formalmente via SQL Editor (nome real `app_settings_tenant_domain_idx`, não `_key` como previsto no arquivo da migration — funcionalmente equivalente).

Conclusão:

> O bloqueio crítico de `tenant_domain` está resolvido. Pendência remanescente, de baixo risco: atualizar `supabase/schema.sql` para refletir a coluna já aplicada em produção (evita que um novo `schema.sql` rodado do zero num projeto novo saia desalinhado do banco real).

Ver auditoria completa e status atualizado: `docs/TENANT_DOMAIN_AUDIT.md`.

---

## 4. Riscos Altos

### 4.1 OneSignal App ID dividido entre banco e variável de ambiente

O servidor usa o `onesignal_app_id` vindo do banco para envio de push, mas o inicializador do OneSignal no cliente usa `NEXT_PUBLIC_ONESIGNAL_APP_ID`.

Risco:

- alterar App ID no painel pode não refletir no cliente;
- push pode ser enviado para um App ID diferente daquele inicializado no navegador;
- exige rebuild para mudanças de variável pública.

Recomendação:

- não mexer agora em produção;
- documentar claramente;
- futuramente unificar a fonte do App ID.

**Atualização (2026-07-01):** o `components/notification-vip-banner.tsx` (banner "Clube
VIP") checa "existe App ID" usando a mesma constante client-side que o
`onesignal-initializer.tsx` já usava (`NEXT_PUBLIC_ONESIGNAL_APP_ID` via
`appConfigClient.oneSignalAppId`), e não `settings.oneSignalAppId` do banco — para não
reabrir essa divergência nem depender de uma fonte diferente da que o SDK foi de fato
inicializado com.

### 4.1.1 Remoção do prompt automático (`Slidedown.promptPush`)

O `onesignal-initializer.tsx` disparava automaticamente `OneSignal.Slidedown.promptPush()`
assim que o `OneSignal.init()` resolvia, abrindo o prompt nativo do navegador sem nenhum
aquecimento prévio. Essa chamada foi removida (2026-07-01). A ativação de notificações
agora acontece via banner "Clube VIP" (`components/notification-vip-banner.tsx`, renderizado
em `app/layout.tsx` para todas as rotas exceto `/admin/**`), que chama
`OneSignal.Notifications.requestPermission()` somente quando o usuário clica em "Ativar
notificações". O restante da inicialização do OneSignal (logs de diagnóstico, listener de
`PushSubscription.change`, sincronização com `/api/push/subscribe`) não foi alterado.

O botão manual pré-existente em `components/notification-button.tsx` (dentro do `<details>`
"Notificações" na página principal) continua usando `Slidedown.promptPush({ force: true })`
e não foi alterado — não é um prompt automático ao carregar, ficou fora do escopo desta
mudança.

---

### 4.2 Service Workers duplicados

Existem arquivos OneSignal em:

- `/public/onesignal/OneSignalSDKWorker.js`
- `/public/OneSignalSDKWorker.js`

O primeiro parece ativo. O segundo é legado.

Risco:

- browsers antigos podem manter registro residual;
- conflito de escopo entre OneSignal e `/sw.js`;
- push pode falhar em alguns dispositivos.

Recomendação:

- não remover imediatamente;
- criar diagnóstico;
- testar antes em ambiente separado;
- só remover legado com plano de rollback.

---

### 4.3 Fallback silencioso de settings

Quando o Supabase falha, o sistema cai para env vars.

Risco:

- o site pode carregar dados antigos ou errados sem ninguém perceber;
- falhas reais de banco ficam mascaradas;
- o admin pode parecer funcionando, mas o cliente estar vendo fallback.

Recomendação:

- adicionar logs claros;
- exibir `source: database/env` em diagnóstico admin;
- criar endpoint de healthcheck.

---

### 4.4 Push sem isolamento por tenant

> **Atualização 2026-07-04: resolvido.** O banco compartilhado (6 tenants ativos,
> ver `docs/TENANT_DOMAIN_AUDIT.md`) já tinha OneSignal habilitado em todos, sem
> nenhuma coluna de tenant em `push_subscriptions`/`push_campaigns` — o risco
> descrito abaixo (escrito quando o projeto ainda era considerado single-tenant)
> deixou de ser teórico. Migration `004_add_tenant_isolation_to_push_tables.sql`
> aplicada em produção (uma única vez, no banco único compartilhado) resolve isso.
> Texto original mantido abaixo como registro histórico.
>
> **O que a migration 004 mudou:**
> - `push_subscriptions` ganhou as colunas `tenant_domain` e `onesignal_app_id`
>   (nullable, sem backfill) e um índice em `tenant_domain`.
> - `push_campaigns` ganhou as mesmas duas colunas e o mesmo índice.
> - Nenhum dado foi apagado, nenhuma tabela recriada, a constraint `unique` em
>   `onesignal_id` e a RLS existente não foram alteradas.
> - As 33 inscrições legadas (anteriores à migration) ficaram com
>   `tenant_domain = null` de propósito — não foram atribuídas a nenhum tenant por
>   suposição. Uma comparação `.eq("tenant_domain", X)` nunca é verdadeira contra
>   `NULL`, então essas linhas somem sozinhas de qualquer contagem, listagem ou
>   envio por tenant.
>
> **O que o código passou a fazer** (`app/api/push/subscribe/route.ts`,
> `app/api/push/send/route.ts`, `app/admin/page.tsx`, idêntico nos 6 repos):
> - Ao registrar uma inscrição, grava `tenant_domain` e `onesignal_app_id` do
>   tenant atual (via `getAppSettings()`).
> - `/admin` conta e lista (inscritos e histórico de campanhas) só do tenant atual.
> - "Enviar para todos" busca inscritos filtrando por `tenant_domain` do tenant
>   atual — nunca mais por `permission_status = granted` sem filtro nenhum.
>   Decisão: o filtro de envio usa só `tenant_domain`, sem também exigir
>   `onesignal_app_id`, para não correr o risco de zerar inscrições válidas do
>   próprio tenant por um desalinhamento momentâneo banco/env; `onesignal_app_id`
>   continua sendo gravado em toda inscrição e campanha, só não é usado como
>   filtro nesta etapa.
> - Histórico de campanhas grava e lista por `tenant_domain`.
>
> **Validação feita em produção, depois do deploy real (2026-07-04), sem enviar
> nenhuma campanha real:**
> - Contagem por tenant nos 6: `0` em todos (as 33 linhas legadas ficaram
>   corretamente invisíveis).
> - Pix Keno e SuperKeno: `0` inscritos, confirmado.
> - Teste real de escrita: inscrição de teste (`onesignal_id` fictício) criada via
>   `POST /api/push/subscribe` em Big Pix (`pwa.app-bigpix.com`) — gravou
>   `tenant_domain = pwa.app-bigpix.com`, apareceu com contagem `1` só em Big Pix e
>   `0` nos outros 5 tenants. Linha removida logo em seguida; total de
>   `push_subscriptions` voltou a 33 (estado original).
> - Simulação read-only do filtro de "enviar para todos" (`tenant_domain` +
>   `permission_status = granted`): `0` destinatários elegíveis nos 6 — nenhum
>   envio real foi disparado durante a validação.
> - `push_campaigns` por tenant: `0` nos 6 (tabela ainda vazia).
> - Service Worker, manifest e `NEXT_PUBLIC_ONESIGNAL_APP_ID`/App IDs: intocados —
>   confirmado por `git diff` escopado antes de cada commit.
>
> Commit `fix: isolate push data by tenant` nos 6 repos; migration e rollback em
> `supabase/migrations/004_add_tenant_isolation_to_push_tables.sql` /
> `.rollback.sql`.
>
> **Pendências remanescentes, fora desta etapa:**
> - WIP do banner de instalação (`components/pwa-install-flow.tsx`,
>   `public/pwa-install/`) segue pausado, não commitado, nos 4 repos originais
>   (Big Pix, MegaBingo7, Oba Prêmios, Prêmios ao Vivo) — ver
>   `HANDOFF_PWA_INSTALL_FLOW.md`.
> - `.env.vercel` solto (untracked) em `app-megabingo7`, fora do `.gitignore`
>   atual (`.gitignore` só cobre `.env` e `.env*.local`) — precisa ser ignorado ou
>   removido com cuidado antes que um `git add` amplo o inclua por acidente.
> - 3 alterações soltas de logging em `app-premiosaovivo`
>   (`app/api/settings/route.ts`, `lib/app-settings.server.ts`,
>   `lib/logger/server.ts`), não commitadas, presentes só nesse repo — decisão
>   pendente: replicar nos outros 5 ou descartar.

(Texto original da auditoria, 2026-06-28, mantido como registro histórico:)

Como o projeto atual é single-tenant por deploy, isso é aceitável por enquanto. Mas se no futuro virar multi-tenant real, as tabelas de push precisam obrigatoriamente ter isolamento.

Campos necessários no futuro:

- `tenant_domain`
- `app_id`
- `campaign_id`
- `device_type`
- `user_agent`
- `permission_status`

---

## 5. Riscos Médios

### 5.1 Falta de auditoria no painel admin

Atualmente, alterações de settings e uploads não parecem gerar histórico persistente.

Risco:

- não saber quem alterou logo, cores ou URLs;
- dificuldade para investigar erro;
- perda de rastreabilidade.

Recomendação:

- criar `admin_audit_logs`;
- registrar alterações importantes;
- registrar antes/depois em JSON.

---

### 5.2 Upload sem limpeza de arquivos antigos

Cada upload gera um path único, mas assets antigos não são removidos.

Risco:

- acúmulo de arquivos órfãos;
- storage crescendo sem controle;
- confusão para auditoria.

Recomendação:

- não apagar nada agora;
- criar inventário de assets;
- futuramente implementar limpeza segura.

---

### 5.3 Ausência de runbook

Quando push, manifest, domínio ou service worker quebrarem, não há guia operacional.

Risco:

- perda de tempo;
- tentativa e erro em produção;
- decisões ruins em emergência.

Recomendação:

- criar `RUNBOOK.md`.

---

## 6. Riscos Baixos

- Textos do modal PWA ainda não existem.
- Admin pode ser melhor organizado.
- Visual e UX podem evoluir.
- Checklist de onboarding ainda precisa ser formalizado.

Esses pontos são importantes, mas não devem vir antes da segurança operacional.

---

## 7. Próximos Passos Recomendados

### Fase 1 — Sem alteração funcional

- criar documentação;
- atualizar visão real da arquitetura;
- listar riscos;
- criar plano de logging;
- criar plano de segurança de produção.

### Fase 2 — Baixo risco

- adicionar logs não invasivos;
- trocar catches silenciosos por logs;
- criar endpoint de diagnóstico somente leitura;
- criar painel de diagnóstico.

### Fase 3 — Médio risco

- adicionar tabelas de auditoria;
- registrar alterações do admin;
- registrar uploads;
- registrar erros técnicos.

### Fase 4 — Alto risco

- revisar Service Worker;
- revisar OneSignal;
- unificar fonte do App ID;
- evoluir para multi-tenant completo com tabelas de push e auditoria isoladas por tenant.

---

## 8. Decisão Arquitetural (aprovada em 2026-06-28)

> **Banco único compartilhado com isolamento por `tenant_domain`.**

Cada deploy Vercel compartilha o mesmo banco Supabase. O campo `tenant_domain` em `app_settings` isola as configurações por cliente, usando o hostname de `NEXT_PUBLIC_PUBLIC_URL` como chave.

**Status (atualizado em 2026-07-02):** a migration já foi executada. Coluna `tenant_domain` confirmada em produção, com as 4 linhas de `app_settings` (Big Pix, MegaBingo7, Oba Prêmios, Prêmios ao Vivo) devidamente isoladas. Índice único confirmado formalmente via SQL Editor (nome real `app_settings_tenant_domain_idx`, funcionalmente equivalente ao `_key` previsto na migration).

**Arquivo de migration:** `supabase/migrations/002_add_tenant_domain_to_app_settings.sql`  
**Detalhes completos:** `docs/TENANT_DOMAIN_AUDIT.md`

Pendência remanescente (baixo risco, não bloqueante): atualizar `supabase/schema.sql` para incluir `tenant_domain`, alinhando o arquivo de schema versionado ao estado real do banco.

