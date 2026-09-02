# LOGGING_PLAN.md

# Plano de Logs e Auditoria

**Projeto:** app-big-pwa  
**Objetivo:** criar rastreabilidade sem colocar produção em risco.

---

## 1. Princípios

- Logs devem ajudar a diagnosticar problemas reais.
- Não devem vazar secrets.
- Não devem registrar senhas.
- Não devem registrar chaves completas.
- Não devem quebrar o fluxo se falharem.
- Logs críticos devem ir para tabela no banco.
- Logs simples podem começar com `console.warn/error`.

---

## 2. Logs Prioritários

## 2.1 Settings

Locais:

- `lib/app-settings.server.ts`
- `app/api/settings/route.ts`
- `app/api/admin/settings/route.ts`

Registrar:

- source: database ou env somente quando houver fallback/erro;
- tenant quando necessario para identificar o deployment;
- nome e codigo sanitizado do erro;
- tempo de resposta;
- fallback usado ou não.

Não registrar em produção: `publicUrl`, URL do Supabase, App ID, payload de
settings ou mensagem/stack bruta do provider.

Objetivo:

- detectar quando o app está usando fallback sem perceber.

---

## 2.2 Admin Settings

Toda alteração no painel deve gerar auditoria.

Tabela sugerida:

```sql
admin_audit_logs
```

Campos:

- `id`
- `admin_email`
- `action`
- `entity`
- `entity_id`
- `before_json`
- `after_json`
- `ip_address`
- `user_agent`
- `created_at`

Eventos:

- settings_updated;
- logo_updated;
- favicon_updated;
- icon192_updated;
- icon512_updated;
- splash_updated;
- splash_html_updated;
- push_settings_updated.

---

## 2.3 Uploads

Local:

- `app/api/admin/upload/route.ts`

O log operacional atual registra somente o evento `admin_upload_error`, a etapa
(`storage_upload` ou `process_file`) e nome/código sanitizado do erro. Nome
original, path, URL pública, payload, IP e user agent não vão para o console.
Uma auditoria persistente mais ampla pertence ao lote futuro M-7 e deve definir
retenção e governança antes de registrar metadados adicionais.

Tabela sugerida:

```sql
asset_upload_logs
```

---

## 2.4 Push

Locais:

- `app/api/push/subscribe/route.ts`
- `app/api/push/send/route.ts`
- `components/onesignal-initializer.tsx`

Registrar subscribe:

- permission_status;
- device_type;
- erro de upsert.

`onesignal_id`, user agent e payload de inscrição não devem aparecer no console.

Registrar campanha:

- title;
- target_type;
- target_url;
- recipient_count;
- status HTTP OneSignal;
- presença de notification ID (boolean), nunca o ID no log;
- erro de parse;
- status final.

Em `push_campaigns.error_message`, falhas do OneSignal usam somente JSON
allowlisted com `provider`, `status`, `code`, `message` curta e `requestId`
quando seguros. O valor tem limite de 500 caracteres; resposta, headers,
destinatários e payload completos não são persistidos.

Melhoria importante:

Substituir parse silencioso:

```ts
.catch(() => ({}))
```

por log controlado do erro.

---

## 2.5 Service Worker

Local:

- `components/service-worker-register.tsx`

Hoje há `.catch(() => {})`.

Trocar por:

- `console.warn`;
- futuramente salvar em `error_logs`.

Registrar:

- sucesso no registro;
- falha no registro;
- escopo;
- ambiente;
- suporte a service worker.

---

## 2.6 Modal de Instalação PWA

Quando for criado, registrar eventos:

- modal_shown;
- modal_dismissed;
- install_clicked;
- install_prompt_available;
- install_prompt_unavailable;
- app_installed;
- ios_instructions_shown;
- standalone_detected.

Tabela futura:

```sql
pwa_install_events
```

Campos:

- `id`
- `event_type`
- `device_type`
- `os`
- `browser`
- `display_mode`
- `user_agent`
- `created_at`

---

## 2.7 Erros Técnicos

Tabela sugerida:

```sql
error_logs
```

Campos:

- `id`
- `source`
- `route`
- `error_name`
- `error_code`
- `metadata_json`
- `created_at`

Usos:

- falha Supabase;
- falha OneSignal;
- falha upload;
- falha settings;
- falha SW;
- falha parse response.

---

## 3. O Que Não Logar

Não registrar:

- senha admin;
- `SUPABASE_SERVICE_ROLE_KEY`;
- `ONESIGNAL_REST_API_KEY`;
- cookies completos;
- tokens;
- payloads sensíveis;
- dados pessoais desnecessários.

---

## 4. Manutenção da Documentação de Logs

Sempre que um novo ponto de log for criado ou alterado, este documento deve ser atualizado com as seguintes informações:

| Campo                         | Descrição                                                         |
|-------------------------------|-------------------------------------------------------------------|
| **Arquivo alterado**          | Caminho completo do arquivo onde o log foi inserido               |
| **Evento logado**             | Nome ou descrição do evento (`settings_fallback`, `sw_error`, etc.) |
| **Nível do log**              | `info`, `warn` ou `error`                                         |
| **Dados registrados**         | Campos e valores que aparecem no log                              |
| **Dados que NÃO devem ser registrados** | Keys, tokens, senhas, dados pessoais desnecessários  |
| **Motivo do log**             | Por que esse ponto precisa de rastreabilidade                     |

Essa atualização faz parte da entrega — nenhum log novo deve ir para produção sem estar registrado aqui.

---

## 5. Estratégia de Implementação

Fase 1:

- logs via console;
- sem alterar banco;
- sem alterar fluxo.

Fase 2:

- criar tabela `error_logs`;
- persistir erros de servidor no banco.

Fase 3:

- criar `admin_audit_logs`;
- auditar alterações de settings.

Fase 4:

- criar dashboard de diagnóstico no admin.

---

## 6. Logs Implementados — Fase 1

**Data:** 2026-06-29  
**Módulo:** `lib/logger/` (types.ts, server.ts, client.ts, index.ts)  
**Prefixos:** `[server-log]` para servidor · `[client-log]` para cliente  

### 6.1 lib/app-settings.server.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `settings_fetch_not_found` | warn | `tenantDomain`, `source: "env"`, `durationMs` | — | Alertar quando tenant_domain não tem registro |
| `settings_fetch_error` | error | `tenantDomain`, `source: "env"`, `durationMs`, `errorName`, `errorCode` quando seguro | mensagem/stack completa, URLs, chaves Supabase | Diagnosticar falhas na query ao banco |
| `settings_fetch_skip` | warn | `tenantDomain`, `reason: "supabase_not_configured"`, `source: "env"` | service role key | Alertar quando Supabase não está configurado |

### 6.2 app/api/settings/route.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `api_settings_error` | error | `tenantDomain`, `source: "env"`, `durationMs`, `errorName`, `errorCode` quando seguro | mensagem/stack completa, URLs, chaves Supabase | Diagnosticar falhas na rota pública de settings |
| `api_settings_fallback` | warn | `tenantDomain`, `reason: "supabase_not_configured"`, `source: "env"` | — | Alertar quando rota cai em fallback sem Supabase |

### 6.3 app/api/push/send/route.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `push_send_started` | info | `targetType`, `recipientCount`, `maskedAppId` (8 chars + "..."), `campaignId` | `ONESIGNAL_REST_API_KEY`, App ID completo | Rastrear início do envio de push |
| `push_send_onesignal_response` | info | `targetType`, `recipientCount`, `httpStatus`, `ok`, `hasNotificationId` (bool), `maskedAppId`, `campaignId` | notification_id completo, REST key | Confirmar resultado da chamada ao OneSignal |
| `push_send_parse_error` | warn | `targetType`, `httpStatus`, `maskedAppId`, `campaignId` | body da resposta | Alertar quando resposta do OneSignal não é JSON válido |
| `push_send_parse_error_detail` | error | `errorName`, `errorCode` quando seguro | mensagem/stack completa | Detalhe técnico mínimo do erro de parse |
| `push_send_error` | error | `step` (fetch_subscriptions / create_campaign), `targetType`, `recipientCount`, `maskedAppId`, `errorName`, `errorCode` quando seguro | mensagem/stack completa, payload, recipients | Rastrear falhas antes da chamada ao OneSignal |

### 6.4 components/service-worker-register.tsx

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `sw_register_error` | error | `swPath: "/sw.js"`, `errorName`, `errorMessage` | stack completa | Substituir `.catch(() => {})` silencioso por log rastreável |

### Módulo lib/logger/

| Arquivo | Responsabilidade |
|---|---|
| `types.ts` | Tipos: `LogLevel`, `LogMetadata`, `LogEntry` |
| `server.ts` | `logServerInfo`, `logServerWarn`, `logServerError` — com `import "server-only"` |
| `client.ts` | `logClientInfo`, `logClientWarn`, `logClientError` — para uso em componentes client |
| `index.ts` | Re-exporta tipos + helpers server (barreira server-only preservada) |

**Invariantes do módulo:**
- Nenhum helper lança exceção — todos envolvidos em `try/catch`
- Erros logam apenas `errorName` e um `errorCode` allowlisted quando disponível;
  mensagem, objeto e stack brutos são descartados
- `oneSignalAppId` é mascarado: `appId.slice(0, 8) + "..."`
- `ONESIGNAL_REST_API_KEY` e `SUPABASE_SERVICE_ROLE_KEY` nunca aparecem nos logs

---

## 7. Logs de segurança CETEC P1 — 2026-08-31

Os eventos abaixo foram adicionados para diagnosticar bloqueios distribuídos sem
persistir ou registrar identificadores em texto claro.

### 7.1 lib/rate-limit.server.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `rate_limit_consume_error` | error | `scope`, `errorName`, `errorMessage` | IP, e-mail, hash HMAC, senha, service role key | Detectar indisponibilidade/erro da RPC de consumo |
| `rate_limit_reset_error` | error | `scope`, `errorName`, `errorMessage` | IP, e-mail, hash HMAC, senha, service role key | Detectar falha ao limpar o bucket de uma conta autenticada |

### 7.2 app/admin/login/page.tsx

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `admin_login_rate_limit_unavailable` | warn | `tenantDomain` | e-mail, IP, senha, hash HMAC | Sinalizar login bloqueado por falha da proteção |
| `admin_login_rate_limited` | warn | `tenantDomain`, `scope`, `retryAfterSeconds` | e-mail, IP, senha, hash HMAC | Diagnosticar excesso sem expor o identificador |
| `admin_login_supabase_auth_ok` | info | `tenantDomain` | e-mail, senha, tokens | Registrar sucesso no fluxo Supabase sem PII |
| `admin_login_authorization_denied` | warn | `tenantDomain` | e-mail, senha, tokens, role, identificador | Registrar identidade Auth valida sem role/acesso ao tenant, sem revelar qual regra falhou |
| `admin_login_supabase_auth_error` | warn | `errorName` | mensagem/stack bruta, e-mail, senha, tokens | Diagnosticar indisponibilidade do Auth sem registrar credenciais |

### 7.3 app/api/admin/logout/route.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `admin_logout_remote_error` | warn | `errorName` | mensagem/stack bruta, cookies, access token, refresh token, e-mail | Registrar falha de revogação remota antes da limpeza local de fallback |

### 7.4 app/api/push/subscribe/route.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `push_subscribe_rate_limit_unavailable` | warn | `tenantDomain` | IP, `onesignal_id`, hash HMAC, service role key | Sinalizar bloqueio seguro por indisponibilidade |
| `push_subscribe_rate_limited` | warn | `tenantDomain`, `scope`, `retryAfterSeconds` | IP, `onesignal_id`, hash HMAC, service role key | Diagnosticar flood por tenant sem expor visitante |

Os buckets no banco guardam apenas `scope`, HMAC-SHA256, contagem e timestamps de
janela/expiração. Nenhum log novo contém token, connection string, senha, e-mail,
IP ou `onesignal_id`.

---

## 8. Hardening CETEC B-2/B-3/B-4 — 2026-09-01

### 8.1 Produção

- `components/onesignal-initializer.tsx`: os diagnósticos do SDK existem somente
  quando `NODE_ENV !== "production"`. Mesmo em development, registram apenas
  booleans/estado agregado; Subscription ID, evento bruto, App ID, mensagem e
  stack não são emitidos.
- `app/page.tsx`: removidos logs de render, redirect, URL da splash, tamanho do
  HTML e erro bruto no console do visitante.
- `lib/app-settings.server.ts` e `app/api/settings/route.ts`: removidos eventos
  informativos por request que incluíam app name/public URL. Permanecem apenas
  fallback/not-found/erro mínimos.
- `app/api/admin/upload/route.ts`: erro bruto do Storage/Sharp foi substituído
  por `admin_upload_error`, com `step`, `errorName` e `errorCode` sanitizado.
- `lib/logger/server.ts` e `lib/logger/client.ts`: objetos, mensagens e stacks
  recebidos não são serializados; somente identificadores curtos no conjunto
  `[a-zA-Z0-9._:-]` são aceitos.

### 8.2 Persistência de falha OneSignal

Formato máximo de 500 caracteres:

```json
{"provider":"onesignal","status":400,"code":"invalid_request","message":"Invalid notification request","requestId":"req_123"}
```

`code` e `requestId` são opcionais e allowlisted. Se a estrutura não for
reconhecida, a mensagem é genérica. Headers, API key, resposta completa,
payload e destinatários nunca são copiados para `error_message`. Em sucesso,
`error_message` permanece `null`.

M-7/`admin_audit_log` continua fora deste lote e não é declarado resolvido.

