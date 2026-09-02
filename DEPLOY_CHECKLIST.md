# Deploy checklist

## Supabase

1. Criar um projeto Supabase para o site/PWA.
2. Abrir o SQL editor do Supabase.
3. Rodar o arquivo `supabase/schema.sql`.
4. Confirmar que as tabelas existem:
   - `push_subscriptions`
   - `push_campaigns`
   - `admin_users`
   - `admin_tenant_access`
5. Copiar `Project URL` para `NEXT_PUBLIC_SUPABASE_URL`.
6. Copiar `anon public` para `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
7. Copiar `service_role` para `SUPABASE_SERVICE_ROLE_KEY`.
8. Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no front-end.
9. Confirmar uma conta no Supabase Auth com linha ativa em `admin_users`.
10. Para role `admin`, confirmar o tenant em `admin_tenant_access`.

## OneSignal

1. Criar um app Web Push no OneSignal.
2. Configurar o dominio HTTPS de producao do PWA.
3. Copiar o App ID para `NEXT_PUBLIC_ONESIGNAL_APP_ID`.
4. Copiar a REST API Key para `ONESIGNAL_REST_API_KEY`.
5. Nunca expor `ONESIGNAL_REST_API_KEY` no front-end.

## Vercel

1. Criar o projeto na Vercel apontando para o repositorio.
2. Configurar o dominio publico HTTPS.
3. Preencher todas as variaveis de ambiente.
4. Fazer deploy.
5. Abrir a URL de producao e conferir se `/manifest.webmanifest` responde.
6. Conferir se o service worker carrega em `public/sw.js`.

## Variaveis obrigatorias

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

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

NEXT_PUBLIC_ONESIGNAL_APP_ID=
ONESIGNAL_REST_API_KEY=
```

## Testes de producao

1. Abrir a home em um Android/Chrome.
2. Instalar o PWA.
3. Abrir o app instalado.
4. Aceitar permissao de notificacao.
5. Confirmar novo registro em `push_subscriptions`.
6. Acessar `/admin/login`.
7. Entrar com uma conta Supabase Auth autorizada para o tenant.
8. Enviar um push de teste.
9. Confirmar recebimento da notificacao.
10. Enviar push para todos.
11. Confirmar campanha registrada em `push_campaigns`.

## Criterios antes de divulgar

- `npm run lint` passando.
- `npm run build` passando.
- Dominio HTTPS configurado.
- Supabase com schema aplicado.
- OneSignal apontando para o dominio correto.
- Admin protegido por Supabase Auth, role ativa e acesso ao tenant.
- Push de teste recebido no dispositivo real.
