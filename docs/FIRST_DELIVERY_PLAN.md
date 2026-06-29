# FIRST_DELIVERY_PLAN.md

**Projeto:** app-big-pwa  
**Data:** 2026-06-28  
**Tipo:** Planejamento — nenhuma implementação neste arquivo.  
**Base:** AUDIT_REPORT.md, TENANT_DOMAIN_AUDIT.md, LOGGING_PLAN.md, PWA_INSTALL_EXPERIENCE.md, PRODUCTION_SAFETY_PLAN.md, ONBOARDING_CLIENTE.md

---

## 1. Resumo do Primeiro Lote

O primeiro lote de entrega tem três objetivos complementares:

1. **Rastreabilidade** — o projeto hoje opera sem logs estruturados fora de algumas áreas isoladas. Erros do Supabase, falhas do Service Worker e problemas no OneSignal passam silenciosamente. Isso precisa mudar antes de qualquer evolução funcional.

2. **Experiência de instalação PWA** — o app não oferece orientação para o usuário instalar o PWA. Android e Windows têm suporte nativo ao prompt. iOS exige instrução manual. Nenhuma dessas experiências existe atualmente.

3. **Push notification confiável** — a estrutura de push existe, mas há pontos cegos: App ID dividido entre banco e variável de ambiente, SW duplicado sem limpeza, parse silencioso da resposta OneSignal. Não será reescrito — será estabilizado.

Este lote **não inclui** Chat Digital, Welcome Chat, automações ou reconstrução estrutural do banco.

**Atenção — bloqueio identificado após auditoria:** antes de iniciar a Etapa 1 (logger), é obrigatório resolver a migration de `tenant_domain`. Ver `docs/TENANT_DOMAIN_AUDIT.md` e Etapa 0 abaixo.

---

## 2. Escopo Incluído

### 2.1 Logs e diagnóstico

- Substituir `.catch(() => {})` silencioso em `service-worker-register.tsx` por `console.warn`.
- Substituir `.catch(() => ({}))` silencioso em `/api/push/send` por log controlado.
- Adicionar log de fonte em `/api/settings` e `lib/app-settings.server.ts` (`source: database | env`).
- Adicionar log quando settings usam fallback de env vars.
- Criar módulo `lib/logger/` com estrutura modular (`index.ts`, `server.ts`, `client.ts`, `types.ts`) — começa apenas com `console`, já preparado para futura integração com Supabase, Sentry, Better Stack ou outro destino, sem alterar o fluxo de retorno das funções.
- Criar módulo `lib/diagnostics/index.ts` com a lógica de diagnóstico; a rota `/api/admin/diagnostics` apenas chama esse módulo.
- Criar painel de diagnóstico somente leitura no admin (sem alterar rotas existentes — nova rota `/api/admin/diagnostics`).

### 2.2 Modal de instalação PWA

- Criar componente `InstallPrompt` com detecção de plataforma (Android, Windows, iOS).
- Implementar controle de exibição via `localStorage` com as seguintes chaves: `pwa_install_dismissed_at`, `pwa_install_completed`, `pwa_install_last_shown_at`, `pwa_install_platform`, `pwa_install_version`, `pwa_prompt_count`, `pwa_install_source`.
- Implementar delay de 10 segundos antes de exibir.
- Implementar controle de 24 horas entre exibições.
- Fluxo Android/Windows: capturar `beforeinstallprompt`, exibir modal, chamar `prompt()` nativo.
- Fluxo iOS: detectar Safari + iOS, exibir modal com instruções manuais (compartilhar → Adicionar à Tela de Início).
- Usar cores e logo vindas de `app_settings` (sem hardcode de cores).
- Não exibir se app já está em modo `standalone`.

### 2.3 Push notification — estabilização

- Registrar em log neutro: fonte usada pelo servidor (banco ou env), App ID mascarado (primeiros 8 caracteres) e `notificationsEnabled`. Sem comparar banco vs env como divergência ou erro neste lote.
- Substituir o parse silencioso da resposta da API OneSignal por tratamento com log.
- Garantir que o componente `OneSignalInitializer` não inicializa duas vezes (guard `__ONESIGNAL_INITED__` já existe — validar).
- Documentar claramente o SW legado (`/public/OneSignalSDKWorker.js`) sem remover ainda.

---

## 3. Escopo Excluído

Os itens abaixo estão **fora deste lote** e não devem ser tocados:

| Área                        | Motivo da exclusão                                          |
|-----------------------------|-------------------------------------------------------------|
| Multi-tenant completo        | O código já usa `tenant_domain`; o bloqueio atual é de schema, não de planejamento. Ver Etapa 0 e `docs/TENANT_DOMAIN_AUDIT.md` |
| Chat Digital                | Fora do escopo do produto PWA white label                  |
| Welcome Chat                | Idem                                                        |
| Automações                  | Idem                                                        |
| Remoção do SW legado        | Risco alto; requer diagnóstico e staging separados          |
| Unificação do App ID (banco vs env) | Exige rebuild; risco em produção; próxima fase     |
| Migration de banco          | Nenhuma neste lote (campos de modal ficam para próxima fase)|
| Schema SQL                  | Nenhuma alteração                                           |
| Tabelas de auditoria (admin_audit_logs, error_logs, pwa_install_events) | Próxima fase |
| Alteração de rotas existentes | Nenhuma                                                   |
| Alteração de autenticação admin | Nenhuma                                                |
| Alteração em `public/sw.js` | Nenhuma                                                    |
| Deploy em produção sem aprovação | Bloqueado por regra do PRODUCTION_SAFETY_PLAN          |

---

## 4. Arquivos que Provavelmente Serão Alterados

Apenas os arquivos abaixo devem ser tocados. Nenhum outro.

### Arquivos modificados (alteração não-destrutiva)

| Arquivo                                          | Alteração prevista                                          |
|--------------------------------------------------|-------------------------------------------------------------|
| `components/service-worker-register.tsx`         | `.catch(() => {})` → `.catch((err) => console.warn(...))`  |
| `app/api/push/send/route.ts`                     | `.catch(() => ({}))` → `.catch((err) => { log; return {} })`|
| `lib/app-settings.server.ts`                     | Adicionar log quando usa fallback                           |
| `app/api/settings/route.ts`                      | Adicionar log de `source: database | env`                   |
| `app/layout.tsx`                                 | Adicionar `<InstallPrompt />` ao body                       |

### Arquivos criados (novos)

| Arquivo                               | Finalidade                                                        |
|---------------------------------------|-------------------------------------------------------------------|
| `lib/logger/types.ts`                 | Tipos compartilhados do logger (`LogLevel`, `LogEntry`, etc.)     |
| `lib/logger/server.ts`                | Logger server-side — `console` agora, extensível para Supabase/Sentry |
| `lib/logger/client.ts`                | Logger client-side — `console` agora, extensível para futuros destinos |
| `lib/logger/index.ts`                 | Re-exporta a API pública do módulo logger                         |
| `lib/diagnostics/index.ts`            | Lógica de diagnóstico somente leitura (separada da rota)          |
| `lib/install/constants.ts`            | Constantes de tempo e chaves de `localStorage`                    |
| `lib/install/platform.ts`             | Detecção de plataforma: Android, iOS, Windows, standalone         |
| `lib/install/storage.ts`              | Leitura e escrita de chaves `pwa_install_*` no `localStorage`     |
| `lib/install/prompt.ts`               | Regras de exibição do prompt (shouldShow, mark dismissed/completed)|
| `components/install-prompt.tsx`       | Componente do modal de instalação PWA (Client Component)          |
| `app/api/admin/diagnostics/route.ts`  | Endpoint GET somente leitura — delega para `lib/diagnostics/`     |

### Arquivos não tocados (confirmação)

`next.config.ts`, `public/sw.js`, `public/onesignal/*`, `public/OneSignalSDKWorker.js`,
`supabase/schema.sql`, `lib/admin-auth.ts`, `lib/supabase/server.ts`, `lib/supabase/client.ts`,
`lib/app-config.ts`, `lib/app-settings.ts`, `app/api/admin/settings/route.ts`,
`app/api/admin/upload/route.ts`, `app/api/push/subscribe/route.ts`,
`components/onesignal-initializer.tsx`, `app/manifest.ts`, `components/admin-settings-form.tsx`.

---

## 5. Riscos por Área

### 5.1 Logs

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| Log vazar informação sensível | Média | Alto | Nunca logar `SUPABASE_SERVICE_ROLE_KEY`, `ONESIGNAL_REST_API_KEY`, senha admin ou tokens completos |
| Log quebrar fluxo se lançar exceção | Baixa | Alto | Helper `logServerError()` deve ter try/catch interno — nunca propagar erro |
| Volume de logs excessivo em produção | Baixa | Médio | Logs de settings devem ser concisos; evitar loop de log |
| Log expor detalhes internos ao cliente | Baixa | Alto | Logs do servidor ficam no terminal/Vercel; nunca retornar stack trace no response JSON |

### 5.2 Modal PWA (geral)

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| Modal aparecer em modo standalone | Média | Médio | Verificar `window.matchMedia('(display-mode: standalone)')` antes de exibir |
| Modal aparecer múltiplas vezes em sequência | Baixa | Baixo | Controle de `localStorage` com timestamp |
| Modal aparecer mesmo com PWA instalado | Média | Médio | Listener em `appinstalled` + flag `pwa_install_completed` |
| Modal aparecer com cor ilegível | Baixa | Médio | Calcular contraste antes de renderizar; fallback para preto/branco |
| `localStorage` indisponível (modo privado) | Baixa | Baixo | Envolver acesso em try/catch; degradar silenciosamente |

### 5.3 Android

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| `beforeinstallprompt` não disparar | Alta | Médio | O evento tem critérios: HTTPS, manifest válido, SW registrado, não instalado. Validar todos antes do lançamento |
| Prompt nativo ignorado pelo usuário | Alta | Baixo | Não é erro — salvar `dismissed_at` e respeitar 24h |
| Modal aparecer em browser sem suporte | Média | Baixo | Checar `'beforeinstallprompt' in window` antes de exibir modal Android |
| Prompt disparado antes do evento estar disponível | Média | Médio | Guardar o evento em ref; só exibir modal quando evento estiver capturado |

### 5.4 Windows

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| Comportamento idêntico ao Android (mesmo fluxo `beforeinstallprompt`) | — | — | Mesma lógica; separar apenas no texto exibido se necessário |
| Edge pode ter comportamento ligeiramente diferente do Chrome | Baixa | Baixo | Testar em ambos durante validação |
| PWA já instalado mas app não detecta | Média | Médio | Listener `appinstalled` + consulta `getInstalledRelatedApps()` se disponível |

### 5.5 iOS

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| Não existe API nativa de instalação — instrução deve ser manual | Certeza | — | Design do modal já prevê instruções passo a passo |
| `beforeinstallprompt` nunca dispara no Safari | Certeza | — | Detectar iOS via userAgent antes de tentar capturar o evento |
| Push notification não funciona no iOS PWA em versões antigas | Alta | Médio | Documentar limitação; não prometer push no iOS por enquanto |
| Modal iOS aparece em Chrome iOS (que não suporta instalação) | Média | Médio | Detectar Safari especificamente, não apenas iOS |
| Instruções erradas para versão específica do iOS | Baixa | Médio | Testar no iOS 16+ e 17+; ícone de compartilhar pode variar |

### 5.6 Push

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| Parse silencioso da resposta OneSignal oculta erros reais | Alta | Alto | **Substituir `.catch(() => ({}))` por log controlado** — principal item desta etapa |
| Campanha criada no banco mas push não enviado | Média | Alto | Registrar status HTTP da resposta OneSignal antes de qualquer outra ação |
| Subscriptions com `permission_status` desatualizado | Média | Médio | Sem correção neste lote; documentar como melhoria futura |
| Limite de 10.000 subscriptions por envio | Baixa | Médio | Valor hardcoded — documentar para revisão futura |

### 5.7 OneSignal

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| App ID do banco diferente da variável de ambiente | Alta | — | Não é tratado como problema neste lote — apenas logar fonte usada e App ID mascarado de forma neutra, sem comparação |
| SDK carregado duas vezes (StrictMode) | Baixa | Médio | Guard `__ONESIGNAL_INITED__` já existe — validar que funciona corretamente |
| Slidedown bloqueado por configuração do app no OneSignal | Média | Médio | Se `promptPush()` falhar, logar e não propagar erro para o usuário |
| Site URL no painel OneSignal diferente do domínio real | Alta | Alto | Coberto no ONBOARDING_CLIENTE.md — validar no checklist pós-deploy |

### 5.8 Service Worker

| Risco | Probabilidade | Impacto | Mitigação |
|-------|:-------------:|:-------:|-----------|
| SW legado (`/OneSignalSDKWorker.js` na raiz) em browsers antigos | Média | Alto | **Não remover neste lote** — apenas documentar e monitorar |
| `/sw.js` em conflito com SW do OneSignal no escopo `/` | Média | Alto | O header `Service-Worker-Allowed: "/"` já mitiga; não alterar `next.config.ts` agora |
| Cache `app-big-v1` preso em browsers — impede atualização | Média | Médio | Qualquer alteração em `sw.js` exige incremento do `CACHE_NAME` — não tocar neste lote |
| Falha silenciosa no registro de `/sw.js` em desenvolvimento | Alta | Baixo | Substituir `.catch(() => {})` por `console.warn` — único toque neste arquivo |

---

## 6. Plano de Implementação em Etapas Pequenas

Cada etapa é independente e pode ser revisada antes da próxima.

### Etapa 0 — Resolver tenant_domain (BLOQUEANTE)

**Prioridade:** esta etapa deve ser concluída e aprovada antes de qualquer outra.

**Problema:** o código usa `.eq("tenant_domain", hostname)` e `.upsert({ onConflict: "tenant_domain" })`, mas a coluna `tenant_domain` não existe em `supabase/schema.sql`. Resultado: settings sempre em fallback; painel admin não consegue salvar.

**Arquivo de migration:** `supabase/migrations/002_add_tenant_domain_to_app_settings.sql`  
**Arquivo de rollback:** `supabase/migrations/002_add_tenant_domain_to_app_settings.rollback.sql`

**Contexto atual do banco (2026-06-29):**

| id | app_name | public_url |
|---|---|---|
| `34d1e99f...` | Big Pix | `https://pwa.app-bigpix.com` |
| `4d72e1d0...` | MegaBingo7 | `https://pwa.app-megabingo7.com` |

**Pré-requisitos obrigatórios antes de executar:**

1. Fazer backup completo do banco Supabase.
2. Confirmar que as duas linhas acima têm `public_url` preenchido e correto.
3. Executar no Supabase Studio (SQL Editor) — não há placeholder para substituir.

**O que a migration faz:**
- Adiciona coluna `tenant_domain text` em `app_settings` (idempotente).
- Preenche `tenant_domain` de cada linha extraindo o hostname de `public_url` via `regexp_replace` (remove `https?://` e barra final) — sem intervenção manual por deploy.
- Valida que nenhuma linha ficou com `tenant_domain NULL`.
- Valida que não há valores duplicados.
- Cria índice único em `tenant_domain` (compatível com `ON CONFLICT (tenant_domain)`).
- Preserva `singleton_key` e todos os dados existentes.

**Critérios de conclusão desta etapa:**

- [ ] `supabase/migrations/002_add_tenant_domain_to_app_settings.sql` executado no banco
- [ ] Linha existente atualizada com hostname correto
- [ ] `GET /api/settings` retorna `source: database` (não `source: env`)
- [ ] Painel admin consegue salvar configurações sem erro 500

**Rollback:** executar `supabase/migrations/002_add_tenant_domain_to_app_settings.rollback.sql`. Remove índice e coluna. O sistema volta ao estado de falha silenciosa anterior.

**Referência completa:** `docs/TENANT_DOMAIN_AUDIT.md` — seção 8.

---

### Etapa 1 — Logger básico do servidor

**Pasta:** `lib/logger/` (nova, 4 arquivos)

```
lib/logger/
├── types.ts    ← LogLevel, LogEntry, LogMeta
├── server.ts   ← logServerError(), logServerInfo() — apenas console neste lote
├── client.ts   ← logClientError(), logClientInfo() — apenas console neste lote
└── index.ts    ← re-exporta a API pública
```

**O que faz:** centraliza todos os logs do projeto em um único módulo. Começa apenas com `console.error` / `console.warn` em formato estruturado JSON. A estrutura já está preparada para receber um segundo destino (Supabase `error_logs`, Sentry, Better Stack ou similar) sem alterar os chamadores.  
**Regra:** nunca logar `SUPABASE_SERVICE_ROLE_KEY`, `ONESIGNAL_REST_API_KEY`, senhas, cookies ou tokens completos. O módulo deve ter essa restrição documentada em `types.ts`.  
**Impacto em produção:** zero — apenas console output no Vercel.

---

### Etapa 2 — Logs de settings e fallback

**Arquivos:** `lib/app-settings.server.ts`, `app/api/settings/route.ts`  
**O que muda:**
- `getAppSettings()` passa a logar quando usa fallback de env vars.
- `GET /api/settings` passa a logar `source: database | env` e nome do app carregado.
**Impacto:** nenhum no retorno da API — apenas log no servidor.

---

### Etapa 3 — Log do Service Worker

**Arquivo:** `components/service-worker-register.tsx`  
**O que muda:** `.catch(() => {})` → `.catch((err) => console.warn('[SW]', err))`.  
**Impacto:** nenhum funcional — só visibilidade de falhas.

---

### Etapa 4 — Log de push e OneSignal

**Arquivo:** `app/api/push/send/route.ts`  
**O que muda:** `.catch(() => ({}))` na linha de parse da resposta OneSignal → `.catch((err) => { logServerError('push/send', err); return {}; })`.  
**Impacto:** nenhum no fluxo — só garante que erros de parse não sejam silenciosos.

---

### Etapa 5 — Módulo de diagnóstico e endpoint admin

**Arquivos:** `lib/diagnostics/index.ts` (novo) + `app/api/admin/diagnostics/route.ts` (novo)

A lógica de diagnóstico fica em `lib/diagnostics/index.ts` — a rota apenas importa e chama esse módulo, sem lógica própria.

```
lib/diagnostics/
└── index.ts    ← getDiagnostics(): Promise<DiagnosticsResult>
```

**Método da rota:** GET, protegido por `isAdminAuthenticated()`  
**Retorna (somente leitura):**
- `source` das settings (`database` ou `env`)
- `appName`, `publicUrl`
- `oneSignalAppId` mascarado (presente/ausente + primeiros 8 chars)
- `notificationsEnabled`
- `supabaseConfigured` (boolean)
- `serviceWorker` (não disponível server-side — campo documentado como "verificar no browser")  

**Impacto:** nova rota somente leitura; zero impacto em produção.

---

### Etapa 6 — Módulo de instalação PWA

**Pasta:** `lib/install/` (nova, 4 arquivos)

```
lib/install/
├── constants.ts  ← DELAY_MS, REPEAT_HOURS, chaves de localStorage, versão
├── platform.ts   ← detectPlatform(), isStandalone(), isSafariIOS(), isChromeIOS()
├── storage.ts    ← getInstallState(), markDismissed(), markCompleted(), incrementPromptCount()
└── prompt.ts     ← shouldShowPrompt() — orquestra platform + storage + constants
```

**Separação de responsabilidades:**
- `constants.ts` — centraliza todos os valores configuráveis (delay, intervalo 24h, nomes das chaves de `localStorage`) em um único lugar.
- `platform.ts` — detecção de plataforma pura, sem efeitos colaterais, sem acesso a `localStorage`.
- `storage.ts` — toda leitura e escrita de `localStorage` (`pwa_install_dismissed_at`, `pwa_install_completed`, `pwa_install_last_shown_at`, `pwa_install_platform`, `pwa_install_version`, `pwa_prompt_count`, `pwa_install_source`) com tratamento de `localStorage` indisponível.
- `prompt.ts` — regra de negócio: combina platform + storage + constants para decidir se o prompt deve ser exibido.

**Impacto:** biblioteca pura client-side; zero impacto no servidor.

---

### Etapa 7 — Modal Android / Windows

**Arquivo:** `components/install-prompt.tsx` (novo, Client Component)  
**O que faz:**
- Captura `beforeinstallprompt` via `useEffect`
- Aguarda 10 segundos
- Exibe modal se plataforma for Android ou Windows e evento capturado
- Botão "Instalar" chama `prompt()` nativo
- Listener `appinstalled` → marca como concluído e fecha modal
- Usa `appSettings` (logo, nome, cor, ícone) passados via props  
**Impacto:** componente novo; não altera nada existente.

---

### Etapa 8 — Modal iOS

**Extensão de:** `components/install-prompt.tsx`  
**O que acrescenta:**
- Detecta Safari + iOS
- Exibe modal com instruções passo a passo (compartilhar → Adicionar à Tela de Início)
- Botão "Entendi" fecha o modal e marca `dismissed_at`
- Não exibe em Chrome iOS (sem suporte real de instalação)

---

### Etapa 9 — Controle de exibição 24h e integração no layout

**Arquivos:** `lib/install/storage.ts`, `lib/install/prompt.ts`, `app/layout.tsx`  
**O que faz:**
- `shouldShowPrompt()` em `lib/install/prompt.ts` verifica `pwa_install_dismissed_at` (respeita 24h) e `pwa_install_completed` (permanente)
- `<InstallPrompt />` adicionado ao `<body>` no layout raiz
- Recebe `settings` como prop (já disponível no layout)  
**Impacto:** `app/layout.tsx` recebe um componente a mais — baixo risco.

---

### Etapa 10 — Testes finais e validação

- Executar todos os cenários do plano de testes manuais (seção 8).
- Confirmar que nenhuma rota existente foi alterada em comportamento.
- Confirmar que logs não expõem dados sensíveis.
- Confirmar que modal não aparece em standalone.
- Confirmar push funcionando com log visível no Vercel.
- Aprovação antes de deploy em produção.

---

## 7. Ordem Recomendada de Execução

```
0.  supabase/schema.sql + banco                       ← BLOQUEANTE: migration tenant_domain (ver Etapa 0)
1.  lib/logger/ (types, server, client, index)        ← logger modular do servidor e cliente
2.  lib/app-settings.server.ts                        ← log de fallback settings
    app/api/settings/route.ts                         ← log de source: database|env
3.  components/service-worker-register.tsx            ← log de falha SW
4.  app/api/push/send/route.ts                        ← log de parse OneSignal (neutro)
5.  lib/diagnostics/index.ts                          ← módulo de diagnóstico
    app/api/admin/diagnostics/route.ts                ← rota que delega para o módulo
6.  lib/install/ (constants, platform, storage, prompt) ← módulo de instalação PWA
7.  components/install-prompt.tsx                     ← modal Android/Windows
8.  components/install-prompt.tsx                     ← modal iOS (extensão do mesmo arquivo)
9.  lib/install/storage.ts + lib/install/prompt.ts    ← controle 24h
    app/layout.tsx                                    ← integração no layout
10. Testes manuais completos                          ← validação final
```

Cada item pode ser revisado e aprovado individualmente antes de avançar para o próximo.

---

## 8. Plano de Testes Manuais

### Cenário 1 — Chrome Android (PWA não instalado)

- [ ] Acessar o domínio pelo Chrome no Android
- [ ] Aguardar 10 segundos
- [ ] Modal de instalação deve aparecer com logo e nome do app
- [ ] Clicar em "Instalar aplicativo"
- [ ] Prompt nativo do Chrome deve aparecer
- [ ] Aceitar instalação
- [ ] App deve aparecer na tela inicial
- [ ] Abrir o app pelo ícone — deve estar em modo standalone
- [ ] Modal **não** deve aparecer novamente

### Cenário 2 — Chrome Android (PWA já instalado)

- [ ] Acessar o domínio pelo Chrome com PWA já instalado
- [ ] Modal **não** deve aparecer
- [ ] Abrir o app pelo ícone — deve estar em modo standalone sem modal

### Cenário 3 — Edge ou Chrome no Windows (PWA não instalado)

- [ ] Acessar o domínio no desktop
- [ ] Aguardar 10 segundos
- [ ] Modal deve aparecer
- [ ] Clicar em instalar — prompt nativo do browser deve aparecer
- [ ] Aceitar instalação
- [ ] App deve abrir em janela standalone

### Cenário 4 — Safari iPhone (iOS)

- [ ] Acessar o domínio no Safari do iPhone
- [ ] Aguardar 10 segundos
- [ ] Modal iOS deve aparecer com instruções de compartilhar → Adicionar à Tela de Início
- [ ] Clicar em "Entendi" — modal deve fechar
- [ ] Esperar 24 horas (ou simular limpando `localStorage`) — modal deve reaparecer
- [ ] Seguir as instruções manualmente — app deve aparecer na tela inicial

### Cenário 5 — Chrome iOS

- [ ] Acessar o domínio no Chrome do iPhone
- [ ] Modal **não** deve aparecer (Chrome iOS não suporta instalação real)

### Cenário 6 — Push notification permitido

- [ ] Acessar o site com OneSignal configurado
- [ ] Aceitar notificação quando solicitado pelo Slidedown
- [ ] Verificar no Vercel Logs que `/api/push/subscribe` foi chamado com `permissionStatus: granted`
- [ ] Enviar push pelo painel admin
- [ ] Notificação deve chegar no dispositivo
- [ ] Verificar nos logs que a resposta OneSignal foi registrada corretamente

### Cenário 7 — Push notification negado

- [ ] Negar a permissão de notificação no Slidedown
- [ ] Verificar que `/api/push/subscribe` foi chamado com `permissionStatus: denied`
- [ ] Verificar que o app não apresenta erro ao usuário

### Cenário 8 — OneSignal ativo (logs)

- [ ] Abrir o app com OneSignal configurado
- [ ] Abrir DevTools → Console
- [ ] Verificar que logs `[OS]` aparecem em sequência correta
- [ ] Verificar que `init()` resolveu com sucesso
- [ ] Verificar que nenhum log expõe a chave completa

### Cenário 9 — Diagnóstico admin

- [ ] Acessar `/admin/login` e autenticar
- [ ] Chamar `GET /api/admin/diagnostics`
- [ ] Verificar `source: database` (não `env`) quando banco configurado
- [ ] Verificar `oneSignalAppId: true` quando configurado
- [ ] Verificar que nenhuma key/secret aparece no response

### Cenário 10 — Controle de 24h (modal)

- [ ] Fechar o modal manualmente
- [ ] Atualizar a página
- [ ] Modal **não** deve reaparecer antes de 24h
- [ ] Limpar `localStorage` manualmente
- [ ] Modal deve reaparecer após 10 segundos

---

## 9. Plano de Rollback

### Rollback de logs (Etapas 1–4)

Os logs são adicionais e não alteram o comportamento das funções. Rollback = reverter os commits específicos de cada arquivo.

Impacto do rollback: zero — o app volta a ter catches silenciosos como antes.

### Rollback do modal PWA (Etapas 6–9)

1. Remover `<InstallPrompt />` do `app/layout.tsx`.
2. Deletar `components/install-prompt.tsx`.
3. Deletar a pasta `lib/install/` completa (`constants.ts`, `platform.ts`, `storage.ts`, `prompt.ts`).

O app volta ao estado anterior sem modal. Nenhum dado persistido em banco. O `localStorage` do usuário pode ter as chaves `pwa_install_*` — são inofensivas e serão ignoradas pelo app revertido.

### Rollback do logger (Etapa 1)

Deletar a pasta `lib/logger/` completa (`types.ts`, `server.ts`, `client.ts`, `index.ts`) e reverter as chamadas nos arquivos que a importam. O app volta a ter catches silenciosos como antes.

### Rollback do diagnóstico (Etapa 5)

Deletar `lib/diagnostics/index.ts` e `app/api/admin/diagnostics/route.ts`. A rota deixa de existir.

### Rollback geral

```
git revert <commit-das-etapas>
```

ou

```
git checkout main -- <arquivos-afetados>
```

Não há migration de banco neste lote. Não há alteração em `next.config.ts` ou variáveis de ambiente. Rollback é simples e seguro.

---

## 10. Pontos que Exigem Aprovação Antes de Mexer

Os itens abaixo **não podem ser iniciados sem aprovação explícita**, mesmo que pareçam pequenos:

| Item | Motivo |
|------|--------|
| Qualquer alteração em `public/sw.js` | SW pode ficar preso em browsers; requer staging e plano próprio |
| Remoção de `/public/OneSignalSDKWorker.js` (legado) | Pode quebrar browsers com SW registrado no escopo raiz |
| Alteração em `next.config.ts` (headers SW) | Mudança de escopo pode afetar todos os clientes |
| Unificação do OneSignal App ID (banco vs env) | Exige rebuild e validação de push em produção |
| Alteração em `components/onesignal-initializer.tsx` | Risco de double-init ou perda de subscriptions |
| Qualquer migration de banco | Nenhuma neste lote — requer processo separado |
| Deploy em produção | Exige checklist do PRODUCTION_SAFETY_PLAN.md e aprovação manual |
| Alteração de variáveis `NEXT_PUBLIC_` no Vercel | Exige rebuild; afeta todos os usuários ativos |
| Adição de campos na tabela `app_settings` | Fora deste lote; próxima fase |

---

## 11. Próximo Documento Planejado

Após a conclusão e aprovação deste primeiro lote, o próximo passo de documentação será a criação de:

**`docs/ROADMAP.md`**

Esse documento reunirá a visão de médio prazo do projeto, incluindo:

- lotes subsequentes (Fase 2, Fase 3...);
- evolução para tabelas de auditoria (`admin_audit_logs`, `error_logs`, `pwa_install_events`);
- planejamento de multi-tenant real (quando e se aplicável);
- unificação do OneSignal App ID entre banco e variável de ambiente;
- remoção controlada do SW legado;
- campos futuros de configuração do modal de instalação no painel admin.

O `ROADMAP.md` **não será criado agora** — apenas após entrega e validação deste lote.

---

## 12. Critérios de Sucesso

O primeiro lote estará concluído quando todos os critérios abaixo forem verificados:

### tenant_domain (Etapa 0 — pré-requisito de tudo)

- [ ] `supabase/schema.sql` contém coluna `tenant_domain text` e índice único
- [ ] Migration executada no banco Supabase
- [ ] `GET /api/settings` retorna `source: database` (não `source: env`)
- [ ] Painel admin consegue salvar configurações sem erro 500

### Logs

- [ ] Falha no registro de `/sw.js` aparece como `console.warn` — não silenciosa
- [ ] Falha no parse da resposta OneSignal aparece nos logs do Vercel
- [ ] `/api/settings` loga `source: database` ou `source: env` a cada request
- [ ] `getAppSettings()` loga quando cai no fallback de env vars
- [ ] Nenhum log expõe chaves, senhas ou tokens

### Diagnóstico

- [ ] `GET /api/admin/diagnostics` retorna dados corretos quando autenticado
- [ ] Retorna 401 quando não autenticado
- [ ] Nenhum dado sensível no response

### Modal de instalação — Android/Windows

- [ ] Modal aparece após 10 segundos em Chrome Android sem PWA instalado
- [ ] Modal usa logo, nome e cor do app vindos das settings
- [ ] Botão instalar aciona o prompt nativo
- [ ] Após instalar, modal não aparece mais
- [ ] Modal não aparece em modo standalone
- [ ] Modal não aparece antes de 24h após fechar

### Modal de instalação — iOS

- [ ] Modal aparece no Safari iOS após 10 segundos
- [ ] Modal **não** aparece no Chrome iOS
- [ ] Instruções estão corretas e visíveis
- [ ] Botão "Entendi" fecha o modal
- [ ] Modal não reaparece antes de 24h

### Push

- [ ] Push de teste enviado pelo painel admin chega no dispositivo
- [ ] Logs no Vercel mostram status HTTP da resposta OneSignal
- [ ] Campanha registrada no banco com `status: sent` ou `status: failed` corretamente
- [ ] Nenhuma campanha fica com status `created` quando OneSignal retorna erro

### Geral

- [ ] Nenhuma rota existente alterou comportamento
- [ ] Nenhum arquivo fora do escopo foi modificado
- [ ] App carrega normalmente em Android, iOS e Windows
- [ ] Painel admin continua funcionando
- [ ] Push continua funcionando para subscriptions existentes
- [ ] Documentação relacionada atualizada junto com cada alteração implementada
