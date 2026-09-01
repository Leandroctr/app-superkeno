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

> **Gap crítico (histórico, já resolvido):** a coluna `tenant_domain` não existia em `supabase/schema.sql` nem no banco. Leitura sempre retornava fallback de env vars. Escrita falhava com erro Postgres. O banco foi corrigido pela migration e, em 2026-09-01, `supabase/schema.sql` foi alinhado como baseline completo para projetos novos. Ver seção 16.

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

Naquele momento, `supabase/schema.sql` (o arquivo de schema base do repositório) **não havia sido atualizado** — a coluna foi adicionada ao banco somente pela execução direta da migration `002`, confirmada em 2026-07-02. O drift do arquivo foi corrigido em 2026-09-01; ver seção 16.

Consequência histórica (antes da migration rodar):

- Todas as leituras retornavam `0 rows` → sistema usava fallback de env vars.
- O UPSERT falhava com erro Postgres por falta de constraint UNIQUE.
- O painel admin não conseguia salvar configurações.

**Situação atual (2026-07-02):** a migration já foi executada. As 4 linhas de `app_settings` têm `tenant_domain` preenchido corretamente. O índice único em `tenant_domain` foi confirmado formalmente via SQL Editor (nome real `app_settings_tenant_domain_idx`, não `_key` como previsto no arquivo da migration — funcionalmente equivalente).

Conclusão:

> O bloqueio crítico de `tenant_domain` e o drift do baseline estão resolvidos. `supabase/schema.sql` agora representa o estado seguro necessário para reconstruir um projeto Supabase novo, sem seed de tenant.

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

**Atualização 2026-09-01:** `supabase/schema.sql` foi alinhado como baseline completo e tenant-neutral. A ordem de reconstrução está documentada na seção 16 e em `docs/PRODUCTION_SAFETY_PLAN.md`.

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

---

## 11. Atualização de segurança do Next.js — 2026-08-31

Esta etapa isolada atualizou somente o runtime do Next.js de `16.2.9` para
`16.2.11`, com versão exata em `package.json`. O objetivo foi tratar os
advisories publicados para a linha 16.2, em especial o DoS de Server Actions no
App Router (CVE-2026-64641 / GHSA-m99w-x7hq-7vfj), aplicável porque o projeto
possui Server Actions. A versão `16.2.11` é a primeira correção na linha 16.2.

O `npm audit` deixou de listar os nove advisories próprios do Next que afetavam
`>=16.0.0 <16.2.11`, incluindo os quatro de severidade alta publicados para a
linha 16.2. Não houve alteração de React, ReactDOM, código funcional,
autenticação, Service Worker, OneSignal, Supabase ou migrations.

### Validações executadas

- instalação reproduzível com `npm ci --no-audit --no-fund`;
- TypeScript com `tsc --noEmit`;
- lint, preservando apenas o warning preexistente de `formatDimension` não
  utilizado;
- build de produção com Next.js `16.2.11`;
- 8 testes CETEC P1;
- smoke HTTP das páginas públicas, login/admin, settings, manifest, Service
  Worker, worker OneSignal e rotas administrativas/push sem autenticação;
- `git diff --check`;
- `npm audit` e inspeção com `npm ls`/`npm explain`.

TypeScript, build e testes passaram. O lint passou com o warning preexistente.
No ambiente local desconectado, `/api/push/subscribe` respondeu `503` por falta
do limitador Supabase, comportamento fail-closed esperado; as demais respostas
de autenticação/autorização e os assets PWA permaneceram coerentes.

### Vulnerabilidades npm remanescentes

O total agregado permaneceu em 7 ocorrências: 1 moderada e 6 altas. A composição,
porém, mudou: desapareceram os advisories próprios do Next, e permaneceram:

- `@tailwindcss/postcss`/PostCSS, diretos apenas no toolchain de build, com
  PostCSS `8.5.15`;
- `brace-expansion` e `js-yaml`, transitivos apenas do ESLint;
- `nanoid` `3.3.13`, transitivo das duas cópias de PostCSS;
- PostCSS `8.4.31`, transitivo do Next, e PostCSS `8.5.15`, transitivo do
  Tailwind; os vetores remanescentes dependem do processamento de CSS ou source
  maps controlados por atacante, que não é uma entrada exposta pela aplicação;
- Sharp `0.34.5`, cópia transitiva opcional do Next, ainda afetada pelo advisory
  herdado do libvips. O Sharp direto usado pelos uploads continua em `0.35.2` e
  os componentes `next/image` do projeto usam `unoptimized`, reduzindo a
  aplicabilidade da cópia interna no runtime atual.

O `npm audit` recomenda Next `16.3.4` porque essa versão passa a depender de
PostCSS e Sharp corrigidos, não porque `16.2.11` permaneça afetado pelo advisory
de Server Actions tratado aqui. A adoção de `16.3.4` deve ser avaliada em etapa
separada, por ser avanço de minor, sem override automático nesta remediação.

---

## 12. Remediação A-1/A-3 — autenticação administrativa — 2026-08-31

Esta etapa foi executada com os deployments Vercel desconectados e sem deploy.
O inventário somente leitura do projeto Supabase PWA-WL encontrou 2 usuários em
`auth.users`, ambos confirmados e não bloqueados; 2 linhas ativas e consistentes
em `admin_users`; e 6 grants ativos em `admin_tenant_access`. Não existem linhas
órfãs, divergências de e-mail/`auth_user_id` nem admins comuns sem tenant.

As roles existentes são `super_admin` e `admin`. Há um `super_admin` ativo,
confirmado e com login Supabase anterior bem-sucedido; pela regra global
existente, ele cobre todos os tenants. O `admin` ativo possui grants explícitos
para BigPix, MegaBingo7, Oba Prêmios, Prêmios ao Vivo, Pix Keno e SuperKeno. O
tenant histórico `pwa.bingonacional.com` não possui grant explícito desse admin,
mas continua coberto pelo `super_admin`. Nenhum tenant ficou sem administrador.

### A-1 — sessão legacy

**Resolvido tecnicamente.** `lib/admin-auth.ts` foi removido. O código não lê
`ADMIN_EMAIL` nem `ADMIN_PASSWORD`, não calcula mais SHA-256 de
`email:password`, não cria a cookie `admin_session` e não aceita seu valor como
identidade. O proxy apenas expira uma eventual cookie antiga com `Max-Age=0`.

A sessão administrativa é exclusivamente a sessão Supabase Auth em cookies
gerenciadas por `@supabase/ssr`. Para este app, que não usa cliente Auth no
browser, elas são `HttpOnly`, `SameSite=Lax`, `Secure` em produção e `Path=/`.
O access token possui expiração emitida pelo Auth; `proxy.ts` renova a sessão e
persiste tokens/cabeçalhos `no-store` antes das rotas protegidas. Os guards usam
`auth.getUser()`, e nunca `getSession()`, para revalidar a identidade no Auth
server em cada request.

Logout passou a ser `POST /api/admin/logout`: executa `signOut` global para
revogar refresh tokens e, se a revogação remota falhar, remove ao menos a sessão
local. O teste real confirmou cookies removidas, refresh token revogado, sessão
expirada/inválida bloqueada e usuário Auth bloqueado sem acesso.

### A-3 — autorização por role e tenant

**Resolvido tecnicamente.** Supabase Auth autentica a identidade;
`admin_users` precisa conter a identidade ativa e uma role reconhecida;
`admin_tenant_access` precisa conter grant ativo para o tenant server-side
quando a role é `admin`. `super_admin` mantém acesso global conforme a regra já
existente. Usuário Auth sem `admin_users`, admin inativo, usuário removido ou
bloqueado e admin sem grant são negados.

Os cinco guards CETEC — `/admin`, `/admin/settings`,
`/api/admin/settings`, `/api/admin/upload` e `/api/push/send` — dependem somente
de `requireTenantAccess()`. Não existe mais expressão
`currentAdmin || legacySession`. A seleção do tenant continua derivada
exclusivamente de `NEXT_PUBLIC_PUBLIC_URL` no servidor; payload do cliente não
pode trocar o tenant. Este PWA não possui interface/rota de gestão de admins;
`requireSuperAdmin()` permanece disponível para uma futura função global, e a
role `admin` não satisfaz esse guard.

### Banco e testes

Nenhuma migration foi necessária e nenhuma definição ou policy foi alterada.
Testes reais com identidades temporárias confirmaram que `authenticated` não
consegue elevar a própria role nem inserir grants em
`admin_tenant_access`. A matriz A-1/A-3 passou 16/16: os 15 cenários obrigatórios
mais logout/revogação. Ela cobriu super_admin, admin autorizado e não autorizado,
usuário Auth sem perfil admin, ausência de sessão, sessão expirada/inválida,
usuário bloqueado, variáveis/cookie legacy e os cinco guards.

Todas as identidades e linhas temporárias foram removidas no teardown. O
pós-check retornou exatamente ao inventário inicial: 2 usuários Auth,
2 `admin_users`, 6 `admin_tenant_access` e zero artefatos temporários. Nenhuma
conta administrativa existente foi modificada.

`ADMIN_EMAIL` e `ADMIN_PASSWORD` foram removidas de `.env.example` e da
documentação operacional. Elas permanecem obsoletas nos ambientes Vercel e
podem ser apagadas futuramente, depois do deploy e da validação operacional
desta versão; nenhuma variável Vercel foi removida nesta etapa.

Permanecem fora deste escopo: A-5 estrutural de `onesignal_id`, nonce/hash da
CSP, vulnerabilidades npm remanescentes, hardening de uploads,
`admin_audit_log` completo e demais P3/P4.

---

## 13. Remediação estrutural A-5 — subscriptions por tenant — 2026-08-31

Esta etapa tratou somente a parte estrutural de A-5. O rate limiting distribuído
do subscribe, já entregue na seção 10, foi preservado sem reimplementação.

### Inventário anterior

O inventário direto do PWA-WL encontrou a tabela `push_subscriptions` com 10
colunas, `id uuid` como primary key, `onesignal_id text not null` e
`tenant_domain text null`. A constraint
`push_subscriptions_onesignal_id_key UNIQUE (onesignal_id)` impunha unicidade
global. Os demais índices eram a PK, `created_at DESC` e `tenant_domain`.
Não existem foreign keys nessa tabela.

RLS estava e continua ativo, sem policies. `anon` e `authenticated` não possuíam
INSERT/UPDATE efetivo; `service_role` possuía SELECT/INSERT/UPDATE/DELETE. O
inventário de dados encontrou 359 linhas: 26 legadas com `tenant_domain = NULL`,
80 BigPix, 114 MegaBingo7, 9 OBA, 51 PixKeno, 30 Prêmios ao Vivo e 49
SuperKeno. Eram 357 `granted`, 2 `default`, todas `device_type = web`, todas UUID
v4 canônicas, sem ID duplicado e sem divergência entre o App ID gravado e o
App ID de `app_settings` nos registros com tenant.

### Novo modelo e migration

A migration
`supabase/migrations/006_scope_push_subscriptions_by_tenant.sql` foi aplicada
ao PWA-WL. Ela removeu somente a unicidade global e criou
`push_subscriptions_onesignal_id_tenant_domain_key UNIQUE
(onesignal_id, tenant_domain)`. Nenhuma linha foi atualizada, removida ou
reclassificada. Os 26 registros legados permaneceram `NULL`; o PostgreSQL
permite múltiplos valores `NULL` nessa constraint e a rota nunca grava tenant
nulo.

A migration é transacional, bloqueia a tabela durante a troca de metadata,
valida colunas e pares existentes, e compara a contagem antes/depois. O ciclo
migration → rollback foi executado dentro de uma transação externa descartada:
359 linhas foram preservadas e a constraint global original foi restaurada
antes do `ROLLBACK`. O rollback definitivo é fail-closed: se já houver um
`onesignal_id` em mais de uma linha, ele aborta antes de qualquer alteração,
pois restaurar unicidade global sem perda seria impossível.

O primeiro hash integral e o hash obtido depois do DDL não coincidiram porque
ao menos uma subscription recebeu `updated_at` novo por escrita concorrente
durante a janela da validação; a contagem permaneceu 359 e a migration não
contém DML. Nenhum `tenant_domain` ou `onesignal_id` foi alterado pela migration,
e a atualização concorrente legítima não foi restaurada nem sobrescrita. Para
cada suíte sintética foi capturado um novo snapshot imediatamente antes do
teste, e o teardown confirmou hash idêntico depois da remoção dos artefatos.

### Fluxo da API e contexto OneSignal

`/api/push/subscribe` continua derivando o tenant exclusivamente de
`NEXT_PUBLIC_PUBLIC_URL` no servidor. O UPSERT agora usa o conflito composto e
grava `tenant_domain` e `onesignal_app_id` somente a partir da configuração
server-side. Campos extras de tenant/App ID enviados no JSON não são lidos.

O identificador aceito deve ser uma string de exatamente 36 caracteres em
formato UUID v4 canônico; maiúsculas são normalizadas para minúsculas, enquanto
whitespace, outras versões, variantes inválidas, coerção de tipo e payload com
mais de 4 KiB são rejeitados. A rota também exige que o App ID de
`app_settings` do tenant seja UUID v4 e coincida com o
`NEXT_PUBLIC_ONESIGNAL_APP_ID` usado para compilar/inicializar o SDK. Uma
configuração cruzada entre marcas falha com 503 em vez de persistir a relação.

O SDK fornece ao browser `OneSignal.User.PushSubscription.id`. A documentação
oficial define Subscription ID como UUID v4 read-only e único no contexto do
App. A API oficial permite consultar uma identidade por App ID + Subscription
ID usando a REST API key, mas os endpoints de leitura têm limite de 1
request/segundo/App e podem responder 429, 5xx ou timeout. Por latência,
disponibilidade e rate limit, essa consulta não foi transformada em dependência
síncrona obrigatória de cada subscribe:

- [Subscription ID e propriedades oficiais](https://documentation.onesignal.com/docs/en/user-subscription-properties)
- [Consulta por Subscription ID](https://documentation.onesignal.com/reference/fetch-identity-by-subscription)
- [Rate limits oficiais](https://documentation.onesignal.com/reference/rate-limits)

Mesmo uma consulta bem-sucedida comprovaria que o ID existe no App esperado,
mas não que o request HTTP atual partiu do navegador proprietário; o SDK não
oferece assinatura/challenge de posse desse ID. O identificador não é tratado
como segredo. A proteção adequada ao modelo atual é: UUID v4 de alta entropia,
tenant e App ID exclusivamente server-side, coerência build/settings, chave
composta e rate limiting distribuído.

### Testes e estado final

A matriz real passou 13/13 em duas execuções, inclusive contra o build de
produção local: A/X e B/X independentes; updates e `permission_status` isolados;
payload de movimentação ignorado; UUID inválido 400; payload grande 413; burst
com 60 respostas de validação e uma 429 com `Retry-After`; escrita anon negada;
escrita `service_role` preservada; consultas do painel e push send filtradas por
tenant; e linha legada `NULL` intacta ao criar a relação tenant-scoped de mesmo
ID. Todos os IDs e buckets sintéticos foram removidos.

Também passaram `npm ci`, TypeScript, lint (somente o warning preexistente),
build Next 16.2.11, 8/8 CETEC P1, 10/10 testes estáticos A-1/A-3, 16/16 testes
reais A-1/A-3, 7/7 testes estáticos A-5 e smoke HTTP de settings, admin/APIs,
manifest, Service Worker, OneSignal Worker e headers/CSP.

O pós-check encontrou novamente 359 linhas, 26 legadas, zero dados sintéticos,
zero pares duplicados, zero UUID inválido e zero App ID divergente. C-1, C-3,
M-9, remoção Apache e permissões das RPCs de rate limit permaneceram intactos;
o bucket `app-assets` continuou público, sem limites de tamanho/MIME e apenas
com sua policy pública de SELECT.

**Estado de A-5:** flood/rate limit, movimentação entre tenants e unicidade
multi-tenant estão resolvidos tecnicamente. A validação de formato e do contexto
App/tenant é suficiente para impedir associação cruzada pelo payload. A prova
criptográfica absoluta de posse do `onesignal_id` continua não oferecida pelo
modelo do OneSignal e permanece registrada como risco residual; por isso A-5
não é declarado integralmente encerrado.

---

## 14. Remediação de uploads A-4, M-3, M-4 e M-6 — 2026-09-01

Este bloco foi propagado semanticamente para o worktree SuperKeno de segurança,
a partir do HEAD `c37435a5284c55f81150425710676546a7d66886`. Não houve migration,
DDL, alteração de configuração do bucket, push ou deploy. As suítes reais criaram
somente identidades, grants, subscriptions, chaves de rate limit e um objeto
PNG sintéticos; todos foram removidos pelos respectivos teardowns.

### Inventário real dos seis tenants

O inventário leu `app_settings` e baixou os assets públicos configurados para
conferir assinatura e `Content-Type`, sem alterar dados. Os cinco campos de
imagem de cada tenant (`logo`, `icon192`, `icon512`, `favicon` e `splash`) usam
URLs no bucket público `app-assets`, nos prefixos correspondentes ao kind.

| Tenant | Imagens ativas | `splashHtmlUrl` ativo | Observação |
|---|---|---|---|
| BigPix | 5 PNG válidos | sim, 398.227 bytes | HTML legado com scripts inline e animações |
| MegaBingo7 | 4 PNG válidos; `icon512` legado malformado | sim, 436.647 bytes | o `icon512` tem extensão/MIME PNG, mas começa com `EF BF BD` antes de `PNG`; não foi alterado |
| OBA Prêmios | 5 PNG válidos | não | — |
| Prêmios ao Vivo | 5 PNG válidos | não | — |
| PixKeno | 5 PNG válidos | não | — |
| SuperKeno | 5 PNG válidos | não | — |

Nenhum asset de imagem ativo usa SVG, ICO, JPEG, WEBP ou GIF. Os SVGs de
fallback em `/public/icons` são arquivos estáticos versionados, não uploads de
tenant, e continuam intactos. Os HTMLs de BigPix e MegaBingo7 possuem sete tags
`script`, sinais de animação e carregamento interno de recurso; removê-los do
consumo nesta etapa quebraria comportamento real.

### A-4 — RESOLVIDO no vetor de novos uploads

SVG, HTML, GIF e ICO são rejeitados pelo servidor. A interface oferece somente
PNG, JPEG e WEBP. O kind `splashHtml` não pertence mais à whitelist de upload.
Além disso, `/api/admin/settings` consulta o valor tenant-scoped atual e aceita
somente preservá-lo ou removê-lo; tentativa de definir um novo URL HTML retorna
400. Assim, um payload manual não contorna o bloqueio da interface.

Os dois HTMLs legados permanecem consumidos para não quebrar tenants ativos,
mas não podem ser substituídos nem recriados pelo aplicativo. Eles continuam
sob o sandbox entregue em C-2, sem `allow-same-origin`. Isso é uma exceção
operacional congelada, não um caminho de novo upload. Sua retirada definitiva
depende de substituir as animações por splash parametrizada/estática em uma
etapa coordenada com BigPix e MegaBingo7.

### M-3 — RESOLVIDO

A whitelist tipada contém somente `logo`, `favicon`, `icon192`, `icon512` e
`splash`. Valor desconhecido, vazio, com traversal, caracteres estranhos ou
tipo manipulado retorna 400. O path do Storage é construído somente depois de
revalidar o kind e normalizar o nome; strings arbitrárias não podem virar
prefixo do bucket.

### M-4 — RESOLVIDO para os formatos suportados

PNG, JPEG e WEBP exigem concordância entre extensão, MIME declarado e assinatura
real. Todo arquivo aceito é decodificado e regravado com Sharp; logo, favicon e
ícones saem em PNG, enquanto splash preserva o codec raster detectado. Arquivo
corrompido, truncado, assinatura incompatível ou falha do Sharp é rejeitado.
Foi removido o fallback inseguro que gravava o original após erro.

O `icon512` malformado do MegaBingo7 é legado já publicado e não foi modificado;
o novo pipeline rejeitaria seu conteúdo em um futuro reupload.

### M-6 — PARCIALMENTE RESOLVIDO

Requests cujo `Content-Length` excede 1 MB mais 64 KB de overhead são rejeitados
com 413 antes de `request.formData()`. Depois do parsing, `File.size` é validado
contra o limite do kind antes de `arrayBuffer()` e o tamanho processado é
validado novamente antes do Storage.

Limitação residual: com `Content-Length` ausente ou falsamente baixo, o runtime
do Next materializa o multipart em `request.formData()` antes de expor o
`File.size`. Fechar integralmente esse caso exige parser multipart streaming.
Essa refatoração e uma dependência adicional não foram introduzidas porque o
ganho não justificaria a complexidade e o risco nesta etapa.

### Limites, dependências e Storage

Os limites existentes foram preservados: logo 500 KB, favicon 100 KB, icon192
300 KB, icon512 500 KB e splash 1 MB. Eles agora valem tanto para o arquivo
bruto quanto para a saída processada. O Sharp direto já existente é suficiente;
nenhuma dependência foi adicionada.

O bucket permanece público e sem mudança de `file_size_limit`,
`allowed_mime_types`, grants ou policies. Um upload real autenticado foi feito
com PNG sintético de 16x16: a rota gravou somente em `logo/...png`, a URL pública
retornou 200 com `image/png` e assinatura PNG válida, e o objeto foi removido no
teardown. O pós-check encontrou zero objetos `cetec-upload-test`, zero usuários
Auth temporários e zero `admin_users` temporários. Nenhum asset legítimo foi
modificado.

### Testes específicos

A suíte `tests/upload-security.test.mjs` cobre whitelist, valores manipulados,
traversal, limite bruto, barreira de `Content-Length`, PNG/JPEG/WEBP reais, MIME
e extensão falsos, magic bytes incompatíveis, corrupção/falha do Sharp,
rejeição de SVG/HTML/GIF/ICO, congelamento do URL HTML legado, autenticação antes
do parsing, path esperado, URL pública e ausência de arquivos temporários.

Resultados finais: 17/17 upload, 8/8 CETEC P1, 10/10 auth estático, 17/17 auth
real (incluindo o upload e o teardown) e 7/7 A-5 estático.
Também passaram `npm ci --no-audit --no-fund`, TypeScript, build de produção no
Next 16.2.11 e lint sem erros (permanece somente o warning preexistente de
`formatDimension`). O smoke local confirmou `/` e `/api/settings` 200; `/admin`
e `/admin/settings` 307 sem sessão; `/api/admin/upload` e `/api/push/send` 401;
`/api/push/subscribe` 400 para payload inválido; manifest, Service Worker e os
dois OneSignal Workers 200.

---

## 15. Remediação CETEC B-2, B-3 e B-4 — 2026-09-01

Esta etapa foi executada nos worktrees de segurança, com os ambientes fora de
produção/desconectados. Não houve SQL, mudança de schema, env, Service Worker,
worker OneSignal, manifest, asset, push real, push Git ou deploy.

### B-2 — RESOLVIDO

`targetUrl` de campanha passa por `lib/push-security.ts`. Uma URL interna deve
começar com exatamente uma barra, não pode começar com `//`, não pode conter
whitespace e, resolvida por `URL` contra o origin do PWA, deve continuar no
mesmo origin. URLs absolutas preservam a regra existente do produto: são
aceitas somente com forma explícita `http://` ou `https://` e confirmação pelo
parser. `javascript:`, `data:`, `file:`, `blob:`, strings inválidas e variantes
protocol-relative são descartadas em favor do fallback seguro.

Não foi criada allowlist de domínio porque não existe evidência de que o
produto deva bloquear os destinos HTTP/HTTPS externos já suportados. Push
interno (`/` e `/pagina`) e absoluto HTTP/HTTPS legítimo permanecem aceitos.

### B-3 — RESOLVIDO

O console do visitante não recebe mais URL/tamanho/render da splash. Logs de
debug OneSignal ficam compilados atrás de `NODE_ENV !== "production"` e não
incluem Subscription ID, evento bruto, App ID, mensagem ou stack, mesmo em
development. Erros de upload usam evento/etapa/nome/código sanitizado. Logs
informativos de settings por request, que continham app name/public URL, foram
removidos; warnings de fallback e eventos agregados de push/rate limit foram
preservados por serem necessários ao troubleshooting.

Os helpers de logger não serializam mais `error.message`, `String(error)` nem
stack: aceitam apenas `errorName` e `errorCode` curtos e allowlisted. Isso reduz
o risco de mensagens de Supabase/Auth/Storage carregarem URLs, detalhes de
infraestrutura ou payloads inesperados.

### B-4 — RESOLVIDO

`push_campaigns.error_message` não recebe mais
`JSON.stringify(oneSignalResult)`. Em falha, persiste JSON com no máximo 500
caracteres contendo apenas `provider: "onesignal"`, status HTTP, código,
mensagem curta sanitizada e request ID quando presentes e seguros. Campos
desconhecidos, objetos profundos, headers, tokens, recipients e resposta bruta
são ignorados. Estrutura desconhecida produz mensagem genérica; sucesso grava
`null`.

A suíte `tests/push-hardening.test.mjs` cobre URLs internas, `//`/`///`, HTTP e
HTTPS absolutos, esquemas perigosos, URL inválida, backslash/whitespace,
fallback, erro simples, resposta enorme/profunda/inesperada, segredo em campo
não permitido, truncamento e ausência de `error_message` em sucesso.

No SuperKeno passaram: instalação reproduzível com `npm ci --no-audit --no-fund`,
TypeScript, build Next 16.2.11, lint sem erros (somente o warning preexistente de
`formatDimension`), CETEC P1 8/8, auth estático 10/10, A-5 estático 7/7,
upload-security 17/17 e B-2/B-3/B-4 8/8. As suítes reais de auth e A-5 ficaram
explicitamente `SKIP`, pois os flags/segredos não existem no worktree
desconectado. O smoke local, sem envio real, confirmou `/` e `/api/settings`
200; admin redirects 307; upload e push send 401 sem sessão; subscribe 503
fail-closed sem Supabase; manifest, Service Worker e os dois workers OneSignal
200, com CSP/headers preservados.

M-7/`admin_audit_log` não pertence a este lote e permanece pendente.

---

## 16. M-8 — baseline do Supabase — 2026-09-01

**Estado: RESOLVIDO no repositório.** Nenhum SQL foi executado e nenhuma
configuração ou dado do PWA-WL foi alterado nesta etapa.

### Inventário e drift

O catálogo real foi consultado em modo somente leitura pela geração oficial de
tipos do projeto PWA-WL. Ela confirmou:

- tabelas públicas `app_settings`, `push_subscriptions`, `push_campaigns`,
  `admin_users` e `admin_tenant_access`, com as colunas e a FK administrativa
  esperadas;
- schema auxiliar `cetec_security`, tabela `rate_limit_buckets` e RPCs públicas
  `consume_rate_limit`/`reset_rate_limit`;
- schema `cetec_audit` com os snapshots/backups históricos da remediação;
- schema `storage` gerenciado pela plataforma;
- bucket `app-assets` público, com `file_size_limit = null` e
  `allowed_mime_types = null`, confirmado também pela API somente leitura.

As definições de constraints, índices, RLS, policies e grants foram confrontadas
com as migrations 002–006, a migration 003 exclusiva do BigPix, o inventário
CETEC e as evidências pós-remediação já versionadas. O catálogo SQL bruto não
foi aberto nesta sessão porque não havia conexão Postgres read-only disponível;
nenhuma credencial foi extraída por caminho alternativo.

Classificação do drift anterior:

| Classe | Diferença |
|---|---|
| A — estrutura legítima ausente | `app_settings.tenant_domain`, índice único por tenant, tabelas administrativas, rate limiter/RPCs, grants e policy segura de Storage |
| B — configuração histórica insegura | policies anon de INSERT/UPDATE em `push_subscriptions`, seed `App Big`, unicidade legada de `singleton_key` e ausência de revokes server-only |
| C — migration representada | colunas/índices 004 e unicidade composta 006 já apareciam parcialmente no arquivo antigo |
| D — não recriar no baseline | `cetec_audit` e seus dados de evidência; internals de `auth` e `storage`, que pertencem à plataforma; dados e identidades de tenants |
| E — drift não explicado | nenhum drift estrutural necessário ficou sem fonte; nomes históricos de policy/índice foram normalizados no baseline |

### Estratégia e reconstrução

A estratégia escolhida é **baseline completo**. Para um projeto Supabase novo e
vazio:

1. criar o projeto pela plataforma Supabase, que fornece `auth` e `storage`;
2. executar uma única vez `supabase/schema.sql`;
3. reexecutar o mesmo arquivo apenas como teste de idempotência, se desejado;
4. criar usuários Auth e dados de tenant pelo onboarding aprovado;
5. validar as invariantes de segurança antes de conectar qualquer deployment.

Não aplicar nem reaplicar migrations 002, 003, 004, 005 ou 006 depois do
baseline completo. Elas permanecem como histórico de evolução de ambientes
anteriores. A migration 003 continua versionada somente no BigPix; sua estrutura
final está incorporada ao baseline comum sem copiar o arquivo histórico.

O baseline não contém seed de tenant, não cria `cetec_audit`, não tenta recriar
schemas internos do Supabase e não inclui dados de qualquer tenant. C-1, C-3 e M-9 permanecem
fechados: tabelas da aplicação têm RLS e revokes para client roles, escrita de
Storage é server-only, e somente a leitura pública do bucket `app-assets` é
declarada.

### Validação

`tests/schema-baseline.test.mjs` valida estruturalmente tabelas, colunas,
constraints, índices, RLS, grants, RPCs, bucket/policy, ausência das policies
inseguras, unicidade `(onesignal_id, tenant_domain)`, neutralidade de tenant e
guardas de reexecução. O Docker Desktop estava indisponível, portanto o schema
não foi aplicado a um Supabase local descartável. Essa limitação não autorizou
uso de produção; a execução real do baseline deve ocorrer primeiro em um novo
staging vazio.

---

## 17. M-5 e B-6 — dependencias e CI — 2026-09-01

Esta etapa foi executada nos worktrees de seguranca, com os ambientes
desconectados. Nao houve SQL, alteracao de Supabase, push Git ou deploy.

### M-5 — PARCIALMENTE RESOLVIDO

As 12 dependencias diretas declaradas como `latest` passaram a usar versoes
explicitas. Bibliotecas de runtime sem advisory foram fixadas na versao ja
validada; nao houve atualizacao oportunista de React, Supabase, ESLint ou
TypeScript para majors/minors mais novas.

Foram aplicadas apenas atualizacoes patch de baixo risco nas raizes corretas:

- `@eslint/eslintrc` 3.3.5 para 3.3.7;
- `@tailwindcss/postcss` e `tailwindcss` 4.3.1 para 4.3.3;
- `eslint-config-next` 16.2.9 para 16.2.11, alinhado ao Next instalado.

O lockfile passou a resolver versoes corrigidas de `brace-expansion`,
`js-yaml`, `nanoid`, `browserslist` e do PostCSS usado pelo Tailwind. O audit
inicial tinha 8 entradas agregadas (7 high, 1 moderate, 0 critical).

Inventario dos advisories e aplicabilidade:

| Entrada npm | Advisory | Cadeia/uso | Resultado |
|---|---|---|---|
| `@tailwindcss/postcss` 4.3.1 | agregado dos GHSAs de PostCSS | direta, somente build CSS | eliminado com 4.3.3 / PostCSS 8.5.26 |
| `brace-expansion` 1.1.15 e 5.0.6 | GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg, GHSA-rgw5-rvv9-x895 | transitiva de ESLint/minimatch; patterns controlados pelo repositorio | eliminado com 1.1.18 e 5.0.9 |
| `browserslist` 4.28.2 | GHSA-c83g-rgw3-j3cx, GHSA-73wf-gq98-2v4g | transitiva de Babel/ESLint; build | eliminado com 4.28.8 |
| `js-yaml` 4.2.0 | GHSA-52cp-r559-cp3m (CVE-2026-59869), GHSA-5p4m-2wfm-xmqj (CVE-2026-59870) | transitiva de ESLint; YAML do repositorio | eliminado com 4.3.2 |
| `nanoid` 3.3.13 | GHSA-28wg-ghj8-5hjv, GHSA-2v37-7h3g-55p8 | transitiva de PostCSS; nao chamada diretamente pelo app | eliminado com 3.3.18 |
| `next` 16.2.11 | entrada agregada por PostCSS/Sharp | direta, runtime e build | residual; fix indicado 16.3.4 |
| `postcss` 8.4.31 do Next | GHSA-qx2v-qp2m-jg93, GHSA-6g55-p6wh-862q, GHSA-fxqj-rqcc-2cmp, GHSA-r28c-9q8g-f849 | transitiva fixa do Next; build com CSS versionado, sem entrada CSS publica | residual; requer Next 16.3.4 |
| `sharp` 0.34.5 do Next | GHSA-f88m-g3jw-g9cj / CVE-2026-33327, 33328, 35590 e 35591 | transitiva do otimizador de imagens do Next; a rota de upload usa Sharp direto 0.35.2 seguro | residual; requer Next 16.3.4 |

Resultado final do audit neste lote: 3 entradas agregadas high, 0 moderate e
0 critical. Nao foi usado `npm audit fix` nem `overrides`.

O Next permanece em 16.2.11. Essa versao fixa internamente PostCSS 8.4.31 e
Sharp 0.34.5, portanto as entradas agregadas `next`, `postcss` e `sharp`
continuam no audit. A correcao indicada pelo registry e Next 16.3.4, que troca
essas dependencias por PostCSS 8.5.23 e Sharp `^0.35.4`. Como 16.3.4 e um minor
do framework e inclui mudancas alem das bibliotecas vulneraveis, ela nao foi
misturada neste commit e exige avaliacao/aprovacao separada. M-5 so podera ser
declarado integralmente resolvido depois dessa decisao e de nova validacao.

### B-6 — RESOLVIDO

`.github/workflows/ci.yml` executa em pull requests e pushes para `main` e
`security/**`, sem deploy. A matriz usa Node.js 22.22.3, cache npm, `npm ci`,
TypeScript, lint, build e as suites estaticas CETEC P1, auth, A-5,
upload-security, push-hardening, schema-baseline e politica de CI.

O build usa somente valores ficticios sob dominios `.invalid`. Suites `:real`
nao rodam no CI inicial e nenhum secret Supabase/OneSignal e declarado.

O audit sempre gera um JSON retido como artefato por 14 dias. A politica falha
fechada se o relatorio for invalido/indisponivel e bloqueia qualquer
vulnerabilidade `critical`. Findings `high` conhecidos permanecem visiveis mas
nao bloqueiam enquanto o upgrade separado do Next estiver pendente; apos esse
lote, a politica deve ser elevada para bloquear `high`.

