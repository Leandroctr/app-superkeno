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

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Scripts

```bash
npm run dev
npm run build
npm run lint
```

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
- Formulario para envio de push teste ou para todos.
- Historico basico de campanhas.

Ainda nao implementado:

- Supabase Auth.
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

ADMIN_EMAIL=
ADMIN_PASSWORD=
```

## White-label

A configuracao principal fica em `lib/app-config.ts`. Para criar uma nova
variacao do PWA, use a mesma base de codigo e altere apenas as variaveis de
ambiente do deploy.

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

O manifest, o splash launcher, o painel e as integracoes publicas consomem
`lib/app-config.ts`, entao nome, descricao, cores, logo e URLs acompanham
automaticamente o ambiente configurado.

## Supabase

1. Crie um projeto no Supabase.
2. Rode o SQL de `supabase/schema.sql` no SQL editor do projeto.
3. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Preencha `SUPABASE_SERVICE_ROLE_KEY` apenas no ambiente servidor/deploy.

Tabelas usadas:

- `push_subscriptions`: inscricoes web push, com `onesignal_id` unico.
- `push_campaigns`: historico basico de campanhas enviadas.

## OneSignal

1. Crie um app Web Push no OneSignal.
2. Configure o dominio publico do PWA no painel OneSignal.
3. Preencha `NEXT_PUBLIC_ONESIGNAL_APP_ID`.
4. Preencha `ONESIGNAL_REST_API_KEY` apenas no ambiente servidor/deploy.

A chave `ONESIGNAL_REST_API_KEY` nunca e usada no client. O front-end inicializa
o SDK, solicita permissao e envia o identificador para `/api/push/subscribe`.
O envio real passa por `/api/push/send`.

## Como testar push

1. Preencha `.env.local` com Supabase, OneSignal e credenciais admin.
2. Rode `npm run dev`.
3. Abra o PWA e, se necessario, expanda a opcao discreta de notificacoes.
4. Confirme no Supabase se uma linha entrou em `push_subscriptions`.
5. Acesse `/admin/login`.
6. Entre com `ADMIN_EMAIL` e `ADMIN_PASSWORD`.
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

## Admin MVP

O painel usa autenticacao simples por variaveis:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Isso e intencional para o MVP. Nao ha Supabase Auth, segmentacao, CRM ou
autenticacao complexa nesta etapa.
