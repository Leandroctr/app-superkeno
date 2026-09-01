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

---

## 9. Remediação CETEC executada — 2026-08-31

O inventário e a remediação foram executados no projeto Supabase **PWA-WL**
enquanto os ambientes estavam desconectados por orientação da auditoria. Não
houve push ou deploy; as alterações foram consolidadas nesta branch após a
validação.

### Resultado dos achados

- **C-1 — corrigido:** removidas as policies anon `Allow anonymous push
  subscription registration` e `Allow anonymous push subscription updates`.
  Grants `INSERT/UPDATE` de `anon` e `authenticated` foram revogados.
  PostgREST com anon retornou `401` para INSERT e UPDATE; `service_role`
  realizou INSERT (`201`) e UPDATE (`200`). A rota local
  `/api/push/subscribe` retornou `200` e o registro exclusivo de teste foi
  removido ao final.
- **C-3 — corrigido:** removidas as policies públicas `allow all 1o5prjj_1`,
  `_2` e `_3` de INSERT/UPDATE/DELETE no bucket `app-assets`. A policy pública
  `_0` de SELECT foi preservada. Um asset exclusivo criado por `service_role`
  permaneceu publicamente legível (`200`); tentativas anon de INSERT/UPDATE
  foram negadas (`400`) e a tentativa de DELETE não removeu o objeto. O
  `service_role` realizou INSERT e UPDATE (`200`) e removeu o artefato de teste.
- **M-9 — corrigido:** removida a policy anon `Allow public read app_settings`
  e revogado o grant direto de SELECT dos client roles. Leitura PostgREST anon
  retornou `401`; `service_role` e `/api/settings` retornaram `200`, com
  `source: "database"` e tenant `pwa.app-superkeno.com`.
- **C-2 — corrigido na branch:** `app/page.tsx` passou de
  `allow-scripts allow-same-origin allow-top-navigation` para
  `allow-scripts allow-top-navigation`. Não existe uso de `contentWindow`,
  `contentDocument`, `window.parent` ou `postMessage` dependente de
  same-origin. A remoção não altera domínio, settings, manifest, Service Worker ou
  assets próprios do tenant. TypeScript e build passaram; lint passou sem
  erros e manteve um warning preexistente fora do escopo.

### Snapshot e rollback

O batch `cetec-security-2026-08-31` preserva em
`cetec_audit.security_snapshot` 13 itens: seis policies, seis grants e a
configuração do bucket. O rollback em `cetec_rollback.sql` recria as definições
reais. Os rollbacks de segurança e Apache foram executados em transações de
teste encerradas com `ROLLBACK`; todos os pós-checks passaram e nenhuma
restauração persistiu. O bucket permaneceu `public = true`, `file_size_limit = null` e
`allowed_mime_types = null`; limites de tamanho/MIME ficaram deliberadamente
para hardening posterior.

### Tenant Apache

`pwa.app.apachejb.app` era um deployment legítimo antigo e descartado, não um
incidente de segurança. O preview encontrou exclusivamente uma linha em cada
uma de `admin_tenant_access`, `app_settings` e `push_subscriptions`, e zero em
`push_campaigns`. A transação salvou as três linhas em
`cetec_audit.apache_row_backup`, registrou o manifest e as removeu. A validação
final encontrou zero referências Apache em todas as tabelas com
`tenant_domain`. Nenhum asset foi apagado porque o ownership tenant-safe não
pôde ser comprovado. O rollback de dados permanece disponível e desativado por
padrão.

As contagens de BigPix, MegaBingo7, OBA Prêmios, Prêmios ao Vivo, PixKeno e
SuperKeno permaneceram exatamente iguais. O inventário também provou que
`pwa.bingonacional.com` possui uma linha em `app_settings` neste Supabase; ela
foi tratada como tenant legítimo adicional e permaneceu intacta.

### Limitações da validação

O fluxo autenticado completo de `/api/admin/upload` não foi executado porque
não havia sessão administrativa disponível no navegador. A guarda sem sessão
retornou `401`, e o mesmo cliente `service_role` usado pela rota foi validado
diretamente com INSERT/UPDATE/DELETE e leitura pública no Storage. A validação
visual da splash também não foi executada porque nenhuma instância de navegador
estava disponível; não é declarada como concluída. O build local com settings
reais do banco foi concluído com sucesso.

---

## 10. Remediação CETEC P1 — 2026-08-31

Esta etapa foi executada com todos os ambientes ainda desconectados. Não houve
push nem deploy. Os achados críticos já tratados na seção 9 não foram reabertos
nem alterados.

### A-2 — proteção do login administrativo

**Corrigido tecnicamente.** O Server Action de `/admin/login` agora consome
contadores distribuídos no Postgres antes de chamar Supabase Auth ou o fallback
legado:

- até 30 tentativas por IP e tenant a cada 15 minutos;
- até 10 tentativas por identificador de conta e tenant a cada 15 minutos;
- o identificador normalizado e o IP são persistidos somente como HMAC-SHA256,
  usando segredo server-side; e-mail, senha e IP não são gravados na tabela;
- no deployment Vercel, a identificação prioriza `x-vercel-forwarded-for`; a
  plataforma fornece esse header e sobrescreve `x-forwarded-for` para impedir
  spoofing direto. Os fallbacks `x-forwarded-for`/`x-real-ip` existem para
  execução local ou proxy compatível e não devem ser tratados como fronteira
  confiável caso a aplicação seja hospedada diretamente fora da Vercel;
- IPv4 usa o endereço validado e IPv6 é normalizado para o prefixo `/64`, evitando
  cardinalidade e evasão triviais por endereços de privacidade do mesmo cliente;
- IP ausente ou inválido cai explicitamente no bucket `unknown`, isolado por
  tenant, em vez de ignorar o limite;
- sucesso de autenticação limpa o bucket da conta, mas não o bucket de IP;
- indisponibilidade do limitador bloqueia o login de forma segura;
- mensagens de erro não informam se a conta administrativa existe e os logs não
  incluem e-mail, IP, senha nem hash.

Teste HTTP local: as tentativas sintéticas 1 a 10 retornaram o mesmo redirect
genérico `error=1`; a 11ª retornou `error=rate_limited`. Os buckets sintéticos
foram removidos. Um login administrativo válido ponta a ponta não foi executado,
pois nenhuma credencial administrativa foi disponibilizada ao processo local;
Supabase Auth e o fallback legado não foram removidos nem reestruturados.

### A-5 — proteção de `/api/push/subscribe`

**Corrigido para flood e validação de entrada; parcialmente pendente no modelo de
identidade OneSignal.** A rota passou a aplicar, por IP e tenant, 60 requisições
por minuto e 500 por hora, com resposta `429` e `Retry-After`. Falha do limitador
retorna `503`. O corpo é limitado a 4 KiB, `onesignal_id` deve ser UUID canônico,
`permissionStatus` continua restrito à lista existente e `deviceType` deve ser
`web`.

O inventário real encontrou 359 inscrições: todas possuem UUID de 36 caracteres,
zero valores inválidos e somente `device_type = web`, portanto a validação é
compatível com os dados atuais. Teste local real confirmou `400` para payload
inválido, `200` para cadastro válido e, em burst concorrente, 58 respostas `200`
restantes e uma `429` com `Retry-After`. O registro sintético foi gravado no
tenant atual com o App ID correto e removido ao final.

A unicidade global de `onesignal_id`, a possível movimentação entre tenants e a
prova de propriedade do identificador **não foram declaradas resolvidas**. Uma
correção definitiva exige decisão de modelo de dados/identidade e permanece no
P2.

### M-2 — headers de segurança e CSP

**Corrigido no código.** Todas as respostas recebem:

- `Content-Security-Policy`, inclusive `frame-ancestors 'none'`;
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `Permissions-Policy` desabilitando câmera, microfone, geolocalização,
  pagamentos e USB.

A CSP permite explicitamente scripts OneSignal, conexões HTTPS/WSS OneSignal e
Supabase, worker próprio/blob, Google Fonts usados pelas splashes HTML e imagens
e mídias HTTPS configuráveis. `unsafe-inline` foi mantido apenas em scripts e
estilos para compatibilidade com o bootstrap do Next.js e HTML de splash atual;
`unsafe-eval` não foi permitido. O header anterior do Service Worker OneSignal
foi preservado.

Validação HTTP local confirmou os cinco headers em `/`, `/admin/login` e no
worker; `frame-ancestors 'none'` impede embedding externo do admin. Build com os
settings reais do tenant atual passou. A validação visual e o console de CSP em
navegador ficaram pendentes porque nenhuma instância de navegador estava
disponível na sessão.

### M-1 — `tenant_domain` na atualização de settings

**Corrigido no código.** `tenantDomain` do JSON é ignorado durante a normalização.
O objeto persistido recebe sempre o hostname derivado server-side de
`NEXT_PUBLIC_PUBLIC_URL`, tanto no UPDATE quanto no UPSERT. A ausência do campo
no payload não pode mais produzir string vazia nem mover a configuração para
outro tenant.

Três testes de regressão cobrem payload malicioso, payload sem `tenantDomain` e
override pelo tenant server-side. O fluxo autenticado de gravação não foi
executado para evitar alterar settings reais sem uma sessão administrativa; o
TypeScript e o build validaram os dois caminhos compilados.

### Migration e invariantes do Supabase

A migration `005_add_distributed_rate_limits.sql` foi aplicada ao PWA-WL. Ela
criou somente `cetec_security.rate_limit_buckets` e as RPCs públicas
`consume_rate_limit`/`reset_rate_limit`, ambas `SECURITY DEFINER` e executáveis
apenas por `service_role`. O schema e a tabela não concedem `USAGE`, leitura ou
escrita a `anon`/`authenticated`; RLS está ativo. Cada consumo remove buckets
expirados, evitando retenção indefinida.

O teste via PostgREST confirmou sequência `true, true, false` para limite 2,
`retry_after_seconds > 0`, nova permissão após expiração e HTTP `401` para RPC
anon. O rollback foi executado dentro de transação descartada, removeu os três
objetos e o `ROLLBACK` os restaurou.

Os hashes de contagens por tenant, policies C-1/C-3/M-9 e configuração do bucket
`app-assets` permaneceram idênticos antes e depois. Nenhum dado de tenant, asset,
`file_size_limit` ou `allowed_mime_types` foi alterado. Ao fim, não restou bucket
nem inscrição sintética de validação.

### Riscos residuais desta etapa

- login válido e teste visual/CSP em navegador ainda precisam de validação
  operacional antes de produção;
- `unsafe-inline` permanece na CSP por compatibilidade e pode ser substituído por
  nonces/hashes em hardening posterior;
- identidade/propriedade e unicidade multi-tenant de `onesignal_id` permanecem
  P2;
- autenticação legacy continua existente e pertence a A-1/A-3/P2;
- `npm audit` ainda aponta 7 pacotes agregados (1 moderado e 6 altos); nenhuma
  dependência foi atualizada nesta etapa.

