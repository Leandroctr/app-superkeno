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

- source: database ou env;
- app name;
- public URL;
- OneSignal App ID presente/ausente;
- erro Supabase;
- tempo de resposta;
- fallback usado ou não.

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

Registrar:

- kind;
- nome original;
- extensão;
- tamanho;
- mime type;
- path gerado;
- URL pública;
- sucesso ou erro;
- admin responsável;
- user agent;
- IP.

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

- onesignal_id;
- permission_status;
- device_type;
- user_agent;
- last_seen_at;
- erro de upsert.

Registrar campanha:

- title;
- target_type;
- target_url;
- recipient_count;
- status HTTP OneSignal;
- resposta OneSignal;
- notification_id;
- erro de parse;
- status final.

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
- `message`
- `stack`
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
| `settings_fetch_start` | info | `tenantDomain` | chaves, tokens, senha | Rastrear início da busca por tenant |
| `settings_fetch_success` | info | `tenantDomain`, `source: "database"`, `appName`, `publicUrl`, `hasOneSignalAppId` (bool), `durationMs` | `oneSignalAppId` completo, service role key | Confirmar leitura do banco com isolamento correto |
| `settings_fetch_not_found` | warn | `tenantDomain`, `source: "env"`, `durationMs` | — | Alertar quando tenant_domain não tem registro |
| `settings_fetch_error` | error | `tenantDomain`, `source: "env"`, `durationMs`, `errorName`, `errorMessage` | stack completa, chaves Supabase | Diagnosticar falhas na query ao banco |
| `settings_fetch_skip` | warn | `tenantDomain`, `reason: "supabase_not_configured"`, `source: "env"` | service role key | Alertar quando Supabase não está configurado |

### 6.2 app/api/settings/route.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `api_settings_response` | info | `tenantDomain`, `source`, `appName`, `publicUrl`, `hasOneSignalAppId` (bool), `durationMs` | `oneSignalAppId` completo, tokens | Confirmar fonte dos dados retornados pela API |
| `api_settings_error` | error | `tenantDomain`, `source: "env"`, `durationMs`, `errorName`, `errorMessage` | chaves Supabase | Diagnosticar falhas na rota pública de settings |
| `api_settings_fallback` | warn | `tenantDomain`, `reason: "supabase_not_configured"`, `source: "env"` | — | Alertar quando rota cai em fallback sem Supabase |

### 6.3 app/api/push/send/route.ts

| Evento | Nível | Dados registrados | Dados NÃO registrados | Motivo |
|---|---|---|---|---|
| `push_send_started` | info | `targetType`, `recipientCount`, `maskedAppId` (8 chars + "..."), `campaignId` | `ONESIGNAL_REST_API_KEY`, App ID completo | Rastrear início do envio de push |
| `push_send_onesignal_response` | info | `targetType`, `recipientCount`, `httpStatus`, `ok`, `hasNotificationId` (bool), `maskedAppId`, `campaignId` | notification_id completo, REST key | Confirmar resultado da chamada ao OneSignal |
| `push_send_parse_error` | warn | `targetType`, `httpStatus`, `maskedAppId`, `campaignId` | body da resposta | Alertar quando resposta do OneSignal não é JSON válido |
| `push_send_parse_error_detail` | error | `errorName`, `errorMessage` | stack completa | Detalhe técnico do erro de parse |
| `push_send_error` | error | `step` (fetch_subscriptions / create_campaign), `targetType`, `recipientCount`, `maskedAppId`, `errorName`, `errorMessage` | — | Rastrear falhas antes da chamada ao OneSignal |

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
- Erros logam apenas `name` e `message`, nunca stack completa
- `oneSignalAppId` é mascarado: `appId.slice(0, 8) + "..."`
- `ONESIGNAL_REST_API_KEY` e `SUPABASE_SERVICE_ROLE_KEY` nunca aparecem nos logs

