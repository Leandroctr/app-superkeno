# M-7 — trilha de auditoria administrativa

**Repositorio canonico da migration:** `Leandroctr/app-big`

**Projeto Supabase compartilhado:** PWA-WL (`myivwdbnpbuooncehwds`)

**Escopo deste repositorio:** nucleo comum; nenhuma migration local

## Contrato

`public.admin_audit_logs` e uma trilha persistente, append-only, server-side e
multi-tenant. Ela independe dos logs da Vercel e preserva snapshots de e-mail e
role do ator mesmo se a linha de `admin_users` for alterada ou removida.

Cada mutacao comum segue obrigatoriamente:

1. gerar `correlation_id` no servidor;
2. inserir `outcome = 'attempt'`;
3. somente apos o insert confirmado, executar a mutacao;
4. inserir um segundo evento com o mesmo `correlation_id` e outcome
   `success`, `failure` ou `partial`.

Falha no `attempt` bloqueia a mutacao com HTTP 503. Falha no evento terminal
gera somente `admin_audit_write_error` sanitizado; uma operacao externa ja
executada nao e desfeita automaticamente e o attempt permanece como evidencia.

## Schema compartilhado e aplicacao unica

A migration canonica
`supabase/migrations/20260915153506_admin_audit_logs.sql` e seu rollback
existem somente no app-big. Ela ja foi aplicada uma vez ao PWA-WL em
2026-09-15 e nao deve ser reaplicada.

Este repositorio nao contem uma migration concorrente. O bloco em
`supabase/schema.sql` representa o estado final compartilhado apenas para
reconstrucao de um projeto Supabase novo e vazio. O baseline completo nunca
deve ser executado sobre o PWA-WL existente.

A tabela tem RLS ativa, zero policies e nenhum privilegio para `PUBLIC`,
`anon` ou `authenticated`. `service_role` recebe somente `SELECT` e
`INSERT` na tabela, alem do acesso minimo a sequence identity. A aplicacao nao
recebe `UPDATE`, `DELETE` ou `TRUNCATE`.

## Acoes comuns instrumentadas

| Superficie | Action | Entidade |
|---|---|---|
| Settings | `settings.updated` | `settings` |
| Upload | `asset.uploaded` | `asset` |
| Push | `push.sent`, `push.failed`, `push.partial` | `push_campaign` |

As acoes de criar, vincular, alterar ou conceder acesso a administradores
continuam exclusivas do BigPix e nao foram ligadas a rotas deste PWA.

## Allowlists

- settings: somente campos configuraveis nao sensiveis; `changedFields`
  contem apenas nomes allowlisted;
- asset: tipo logico, MIME final e tamanho em bytes; `entity_id` e o path
  interno final;
- push: campaign id, tipo de alvo, contagem, status HTTP e booleanos de estado.

URLs perdem credenciais, query string e fragmento. Cada objeto JSON tem limite
de 16 KiB. Senhas, hashes, tokens, cookies, authorization, TOTP, QR, keys,
recipients, arquivo, base64, payload HTTP bruto, resposta integral do OneSignal
e nome original de upload nao sao persistidos.

Login, logout, MFA e password reset continuam fora do M-7 por serem eventos de
autenticacao/sessao. Nenhuma senha e auditada e nenhuma nova superficie
privilegiada foi criada.

## Validacao desta propagacao

A propagacao usa somente testes locais e estaticos. Nenhum SQL e executado,
nenhum evento artificial e inserido e nenhum dado do Supabase compartilhado e
alterado. A validacao funcional real permanece a ja concluida no BigPix.

Passaram: npm ci, typecheck, build, lint sem erros, M-7 13/13, CETEC 8/8,
auth/MFA 16/16, upload 22/22, push hardening 8/8, push subscriptions 7/7,
PWA 15/15, schema 8/8, CI policy 15/15 e git diff check. O npm audit retornou
zero vulnerabilidades, inclusive zero HIGH e zero CRITICAL. O lint preserva
somente o warning preexistente de `formatDimension`.

Nao existe UI `/admin/auditoria` nesta etapa.
