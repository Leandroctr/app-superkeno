# White-label PWA

Base Next.js mobile-first para gerar PWAs reutilizaveis para diferentes marcas,
sites e plataformas.

## Stack

- Next.js com App Router
- React
- TypeScript
- Tailwind CSS
- ESLint
- Supabase
- OneSignal Web Push
- PWA launcher com splash, manifest dinamico e service worker

## Como executar

O baseline de desenvolvimento e CI usa Node.js `22.22.3` e npm `10`. Instale
exatamente o lockfile versionado:

```bash
npm ci --no-audit --no-fund
npm run dev
```

Abra `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm run test:security
npm run test:auth
npm run test:push-subscriptions
npm run test:upload
npm run test:push-hardening
npm run test:schema-baseline
npm run test:ci-security
```

As suites terminadas em `:real` exigem infraestrutura e credenciais controladas
e nao fazem parte da matriz inicial do CI.

## Integracao continua

`.github/workflows/ci.yml` executa em pull requests e em pushes para `main` e
branches `security/**`. O workflow usa Node.js `22.22.3`, cache oficial do npm,
`npm ci`, TypeScript, lint, build e todas as suites estaticas de seguranca. O
build recebe somente configuracao ficticia com dominios `.invalid`; nenhuma
credencial Supabase ou OneSignal e usada.

O `npm audit` gera um artefato JSON em toda execucao. A politica inicial falha
quando existe vulnerabilidade `critical` ou quando o relatorio nao pode ser
validado. Findings `high` conhecidos continuam visiveis no relatorio, mas so
passarao a bloquear depois da decisao separada sobre a atualizacao do Next.

## Status atual

Implementado:

- Projeto Next.js com TypeScript, App Router, Tailwind CSS e ESLint.
- Arquitetura white-label/multi-site centralizada em `lib/app-config.ts`.
- Splash launcher mobile-first consumindo configuracoes por variaveis de ambiente.
- Manifest dinamico em `app/manifest.ts`.
- Service worker em `public/sw.js`.
- Integracao inicial Supabase client/server.
- Schema Supabase com `push_subscriptions` e `push_campaigns`.
- Inicializacao OneSignal no front-end sem expor chave REST.
- API `/api/push/subscribe` para salvar inscricoes push.
- API `/api/push/send` para envio server-side via OneSignal.
- Painel admin MVP em `/admin`.
- Login admin MVP em `/admin/login`.
- Supabase Auth como identidade administrativa, com roles em `admin_users` e
  acesso por tenant em `admin_tenant_access`.
- Painel white-label em `/admin/settings`.
- API publica `/api/settings` para leitura da configuracao ativa.
- API admin `/api/admin/settings` para salvar identidade e comportamento do PWA.
- API admin `/api/admin/upload` para enviar ativos visuais ao Supabase Storage.
- Formulario para envio de push teste ou para todos.
- Historico basico de campanhas.

Ainda nao implementado:

- Segmentacao avancada.
- CRM.
- Campanhas automaticas.
- Dashboard complexo.
- Login de usuario final.

## Ambiente

Copie `.env.example` para `.env.local` e preencha:

```env
NEXT_PUBLIC_APP_NAME=
NEXT_PUBLIC_APP_SHORT_NAME=
NEXT_PUBLIC_APP_DESCRIPTION=
NEXT_PUBLIC_PLATFORM_URL=
NEXT_PUBLIC_SUPPORT_URL=
NEXT_PUBLIC_PUBLIC_URL=
NEXT_PUBLIC_LOGO_URL=
NEXT_PUBLIC_THEME_COLOR=
NEXT_PUBLIC_BACKGROUND_COLOR=
NEXT_PUBLIC_APP_MODE=
NEXT_PUBLIC_HOME_EYEBROW=
NEXT_PUBLIC_HOME_PRIMARY_ACTION=
NEXT_PUBLIC_HOME_SUPPORT_ACTION=
NEXT_PUBLIC_HOME_FLOATING_SUPPORT=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_ONESIGNAL_APP_ID=
ONESIGNAL_REST_API_KEY=
```

## White-label

A configuracao principal pode ser editada em `/admin/settings`. O painel salva
um registro global em `app_settings` no Supabase e permite alterar identidade,
URLs, cores, splash, delay de redirecionamento, icones, favicon, logo e estado
das notificacoes sem editar `.env`.

Se o Supabase nao estiver configurado, a tabela ainda nao existir ou a busca
falhar, o app usa fallback das variaveis de ambiente lidas por `lib/app-config.ts`
e `lib/app-config.client.ts`.

## Fluxo publico do PWA

O front publico funciona como launcher/splash app:

1. O usuario abre o PWA pela tela inicial instalada ou pelo dominio publico.
2. A tela de splash exibe logo, nome da marca e a mensagem
   `Carregando ambiente seguro...`.
3. Depois de 1500ms, o PWA redireciona automaticamente para
   `NEXT_PUBLIC_PLATFORM_URL`.
4. O botao pequeno `Abrir agora` fica disponivel como fallback caso o navegador
   bloqueie ou atrase o redirecionamento.
5. Se `NEXT_PUBLIC_PLATFORM_URL` estiver vazia ou configurada como `#`, o
   redirecionamento nao acontece e a tela mostra uma mensagem amigavel de
   configuracao pendente.
6. O link de suporte usa `NEXT_PUBLIC_SUPPORT_URL`; notificacoes ficam como
   opcao secundaria discreta na propria tela.

Variaveis que normalmente mudam por dominio/site:

- `NEXT_PUBLIC_APP_NAME`: nome completo exibido no app.
- `NEXT_PUBLIC_APP_SHORT_NAME`: nome curto usado no manifest e UI compacta.
- `NEXT_PUBLIC_APP_DESCRIPTION`: descricao do PWA.
- `NEXT_PUBLIC_PLATFORM_URL`: destino automatico do splash launcher.
- `NEXT_PUBLIC_SUPPORT_URL`: destino do link de suporte.
- `NEXT_PUBLIC_PUBLIC_URL`: dominio publico do PWA.
- `NEXT_PUBLIC_LOGO_URL`: URL publica do logo da marca.
- `NEXT_PUBLIC_THEME_COLOR`: cor principal da marca.
- `NEXT_PUBLIC_BACKGROUND_COLOR`: cor de fundo do app.
- `NEXT_PUBLIC_SUPABASE_URL`: projeto Supabase da variacao.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave anonima Supabase da variacao.
- `NEXT_PUBLIC_ONESIGNAL_APP_ID`: app OneSignal da variacao.
- `NEXT_PUBLIC_HOME_EYEBROW`: legado do layout anterior, mantido para
  compatibilidade.
- `NEXT_PUBLIC_HOME_PRIMARY_ACTION`: legado do layout anterior, mantido para
  compatibilidade.
- `NEXT_PUBLIC_HOME_SUPPORT_ACTION`: legado do layout anterior, mantido para
  compatibilidade.
- `NEXT_PUBLIC_HOME_FLOATING_SUPPORT`: legado do layout anterior, mantido para
  compatibilidade.

O manifest, o splash launcher, o painel e as integracoes publicas consomem as
configuracoes salvas no Supabase quando possivel. Nome, descricao, cores, logo,
icones, favicon, imagem de splash e URLs acompanham automaticamente o registro
ativo; em caso de falha, o fallback por `.env` mantem o PWA funcionando.

Para criar uma nova marca:

1. Configure dominio, DNS e deploy da nova marca.
2. Preencha as variaveis minimas de ambiente na Vercel para Supabase e
   integracoes externas.
3. Garanta uma identidade no Supabase Auth com linha ativa em `admin_users`.
4. Para role `admin`, conceda o tenant em `admin_tenant_access`.
5. Rode `supabase/schema.sql` no projeto Supabase quando aplicavel.
6. Acesse `/admin/login` e abra `/admin/settings`.
7. Ajuste nome, URLs, cores, logo, favicon, icones, splash e notificacoes.
8. Teste `/manifest.webmanifest`, instalacao do PWA e redirecionamento.

Ainda dependem de configuracao externa:

- Dominio publico e DNS.
- Variaveis de ambiente da Vercel.
- Projeto Supabase e `SUPABASE_SERVICE_ROLE_KEY`.
- OneSignal REST key para envio server-side.
- Configuracao do dominio HTTPS no OneSignal.
- Arquivos externos que ainda nao tenham sido enviados pelo painel.

## Ativos visuais e uploads

O painel `/admin/settings` aceita upload de imagens e preenche automaticamente
as URLs salvas em `app_settings`. A rota `/api/admin/upload` usa o Supabase
Admin no servidor, valida formato e tamanho, envia o arquivo para o bucket
`app-assets` e retorna uma URL publica.

Formatos aceitos:

- `png`
- `jpg`
- `jpeg`
- `webp`
- `svg`
- `ico`

Limites por ativo:

- Logo principal: 512x512 px recomendado, ate 500 KB.
- Favicon: 32x32 px recomendado, ate 100 KB.
- Icone PWA 192: 192x192 px obrigatorio, ate 300 KB.
- Icone PWA 512: 512x512 px obrigatorio, ate 500 KB.
- Splash Screen: 1080x1920 px recomendado, ate 1 MB.

O painel mostra preview, nome do arquivo, dimensoes, tamanho em KB, alerta
quando a resolucao nao bate com a recomendacao e indicador de qualidade. Os
campos manuais de URL continuam disponiveis em "Configuracao avancada por URL"
para compatibilidade.

## Supabase

1. Crie um projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no SQL editor do projeto.
3. Confirme que o bucket publico `app-assets` existe em Storage.
4. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
5. Preencha `SUPABASE_SERVICE_ROLE_KEY` apenas no ambiente servidor/deploy.

O SQL tenta criar/atualizar o bucket publico automaticamente:

```sql
insert into storage.buckets (id, name, public)
values ('app-assets', 'app-assets', true)
on conflict (id) do update set public = excluded.public;
```

Se preferir criar manualmente pelo painel do Supabase, acesse Storage, crie o
bucket `app-assets` e marque como publico.

Tabelas usadas:

- `push_subscriptions`: inscricoes web push, com `onesignal_id` unico.
- `push_campaigns`: historico basico de campanhas enviadas.
- `app_settings`: configuracao white-label global do PWA.

## OneSignal

1. Crie um app Web Push no OneSignal.
2. Configure o dominio publico do PWA no painel OneSignal.
3. Preencha `NEXT_PUBLIC_ONESIGNAL_APP_ID`.
4. Preencha `ONESIGNAL_REST_API_KEY` apenas no ambiente servidor/deploy.

A chave `ONESIGNAL_REST_API_KEY` nunca e usada no client. O front-end inicializa
o SDK, solicita permissao e envia o identificador para `/api/push/subscribe`.
O envio real passa por `/api/push/send`.

## Como testar push

1. Preencha `.env.local` com Supabase e OneSignal.
2. Rode `npm run dev`.
3. Abra o PWA e, se necessario, expanda a opcao discreta de notificacoes.
4. Confirme no Supabase se uma linha entrou em `push_subscriptions`.
5. Acesse `/admin/login`.
6. Entre com uma conta Supabase Auth ativa e autorizada para o tenant.
7. Em `/admin`, envie um teste ou envie para todos.
8. Confira o registro em `push_campaigns`.

Em desenvolvimento local, push web pode depender de suporte do navegador,
HTTPS ou regras do proprio OneSignal para localhost.

## Checklist de deploy

Antes de publicar:

1. Criar projeto Supabase.
2. Rodar `supabase/schema.sql`.
3. Criar app Web Push no OneSignal.
4. Configurar dominio HTTPS no OneSignal.
5. Configurar variaveis de ambiente na Vercel.
6. Fazer deploy.
7. Testar `/manifest.webmanifest`.
8. Testar instalacao Android.
9. Testar permissao push.
10. Testar inscricao em `push_subscriptions`.
11. Testar login em `/admin/login`.
12. Testar envio pelo painel admin.
13. Conferir historico em `push_campaigns`.

Veja o passo a passo completo em `DEPLOY_CHECKLIST.md`.

## Administracao

Supabase Auth e a unica fonte de identidade administrativa. A tabela
`admin_users` define as roles `super_admin` e `admin`; `admin_tenant_access`
define os tenants permitidos para cada `admin`. `super_admin` segue a regra
global existente. Usuarios Auth sem linha ativa em `admin_users` nao entram no
painel. `ADMIN_EMAIL`, `ADMIN_PASSWORD` e a antiga cookie `admin_session` nao
sao mecanismos de autenticacao e podem ser removidos dos ambientes Vercel
depois que esta versao for implantada e validada.
