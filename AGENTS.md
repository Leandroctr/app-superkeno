# Instruções permanentes do projeto

Este arquivo define regras obrigatórias para qualquer agente de IA que trabalhe neste repositório.

---

## Leitura obrigatória antes de qualquer alteração

Sempre ler, nesta ordem:

1. `docs/AUDIT_REPORT.md`
2. `docs/TENANT_DOMAIN_AUDIT.md`
3. `docs/PRODUCTION_SAFETY_PLAN.md`
4. `docs/FIRST_DELIVERY_PLAN.md`
5. `docs/LOGGING_PLAN.md`
6. `docs/PWA_INSTALL_EXPERIENCE.md`
7. `docs/ONBOARDING_CLIENTE.md`
8. `docs/ROADMAP.md` (quando existir)

Se algum documento estiver ausente, continuar normalmente.

---

## Regras do projeto

Este projeto está em produção.

Nenhuma alteração estrutural pode ser feita sem aprovação.

**Nunca:**

- alterar Service Worker sem aprovação;
- alterar OneSignal sem aprovação;
- alterar schema SQL sem aprovação;
- alterar autenticação sem aprovação;
- alterar `NEXT_PUBLIC_*` sem aprovação;
- alterar produção diretamente;
- fazer deploy automático;
- fazer commit automático.

---

## Sincronização entre PWAs

**Este repositório alimenta múltiplos projetos PWA em produção simultaneamente.**

PWAs ativos:

| Cliente | Domínio | Vercel | GitHub |
|---|---|---|---|
| BigPix | `pwa.app-bigpix.com` | `moline/app-big` | `Leandroctr/app-big` |
| MegaBingo7 | `pwa.app-megabingo7.com` | `moline/app-megabingo7` | `Leandroctr/app-megabingo7` |
| ObaPremios | `pwa.app-obapremios.com` | `moline/app-obapremios` | `Leandroctr/app-obapremios` |
| PremiosAoVivo | `pwa.app-premiosaovivo.com` | `moline/app-premiosaovivo` | `Leandroctr/app-premiosaovivo` |
| Pix Keno | `pwa.app-pixkeno.com` | `moline/app-pixkeno` | `Leandroctr/app-pixkeno` |
| SuperKeno | `pwa.app-superkeno.com` | `moline/app-superkeno` | `Leandroctr/app-superkeno` |

### Distinção entre commit local e versão aprovada

- Commits locais, experimentais ou em desenvolvimento **não precisam** ser implantados imediatamente em todos os PWAs.
- Toda **versão aprovada para produção** deve ser implantada em todos os PWAs ativos sem exceção.
- Uma entrega só é considerada **concluída** quando todos os PWAs ativos estiverem rodando a mesma versão aprovada.

### Diferenças permitidas entre clientes

As únicas diferenças aceitas entre projetos são configuradas via variáveis de ambiente ou banco de dados — nunca via código:

- `tenant_domain`
- `NEXT_PUBLIC_PUBLIC_URL`
- Domínio (DNS e Vercel)
- Imagens: logos, ícones, splash
- Cores e tema
- OneSignal App ID
- Dados em `app_settings`
- Variáveis de ambiente específicas do cliente

### Diferenças não permitidas entre clientes

É **proibido** que os PWAs em produção apresentem divergências em:

- Código-fonte (lógica de upload, push, autenticação, rotas)
- Service Worker — qualquer diferença exige aprovação explícita
- Manifest — qualquer diferença exige aprovação explícita
- Schema ou migrations aplicadas parcialmente — deve haver documentação registrando o estado de cada PWA

### Verificação obrigatória antes de considerar uma versão concluída

1. Listar todos os PWAs ativos (tabela acima).
2. Confirmar o commit/build implantado em cada um.
3. Confirmar que nenhum PWA ficou desatualizado.
4. Se algum PWA não puder ser atualizado no momento, registrar a pendência explicitamente antes de encerrar a sessão.

**Nunca assumir que um push em um repositório atualiza os demais.**

### Regra futura planejada

Criar endpoint de diagnóstico/versionamento (`/api/admin/version` ou similar) para exibir commit, build e tenant de cada PWA em tempo real — a ser implementado em etapa posterior com aprovação.

---

## Fluxo obrigatório

**Antes de implementar:**

1. Informar quais arquivos serão alterados.
2. Informar riscos.
3. Informar impacto esperado.

**Depois de implementar:**

1. Listar arquivos criados.
2. Listar arquivos modificados.
3. Atualizar a documentação correspondente.
4. Mostrar `git status --short`.
5. Esperar aprovação antes de commit.
6. Após o commit, verificar quais PWAs ainda não têm o commit e fazer push para todos.

---

## Documentação

Toda alteração técnica relevante deve atualizar a documentação correspondente.

| Área alterada     | Documento a atualizar          |
|-------------------|--------------------------------|
| Logs              | `docs/LOGGING_PLAN.md`         |
| Modal PWA         | `docs/PWA_INSTALL_EXPERIENCE.md` |
| Arquitetura       | `docs/AUDIT_REPORT.md`         |
| Planejamento      | `docs/FIRST_DELIVERY_PLAN.md`  |
| Roadmap           | `docs/ROADMAP.md`              |
| Novos PWAs        | `AGENTS.md` + `CLAUDE.md` (tabela de PWAs ativos) |

Uma implementação não é considerada concluída enquanto a documentação não estiver atualizada e todos os PWAs não estiverem no mesmo commit.

---

## Arquitetura atual

O projeto opera em **multi-tenant por domínio** — settings identificados por `tenant_domain`, em um banco Supabase **compartilhado pelos 4 PWAs ativos** (tabela acima).

> **Antes:** White label por deploy individual — settings identificados por `singleton_key` (coluna legada, mantida no banco sem uso no código).

> **Agora:** confirmado em 2026-07-02, por leitura direta do banco compartilhado, que a migration `supabase/migrations/002_add_tenant_domain_to_app_settings.sql` já foi executada: a coluna `tenant_domain` existe e as 4 linhas de `app_settings` (Big Pix, MegaBingo7, Oba Prêmios, Prêmios ao Vivo) já têm valores distintos e corretos. O índice único em `tenant_domain` foi confirmado formalmente via SQL Editor em 2026-07-02 — nome real `app_settings_tenant_domain_idx` (diferente do `app_settings_tenant_domain_key` previsto no arquivo da migration, mas funcionalmente equivalente: `UNIQUE INDEX ... USING btree (tenant_domain)`), necessário para o `upsert` do painel admin funcionar — ver `docs/TENANT_DOMAIN_AUDIT.md`.
>
> **Pendência de baixo risco (não bloqueante):** `supabase/schema.sql` ainda não foi atualizado para incluir `tenant_domain` — a coluna existe em produção só porque a migration rodou diretamente no banco. Alinhar o schema base é recomendado, mas não é urgente.

Antes de qualquer desenvolvimento, ler: `docs/TENANT_DOMAIN_AUDIT.md`.

---

## Filosofia

Priorizar:

1. Segurança.
2. Clareza.
3. Simplicidade.
4. Baixo risco.
5. Pequenas implementações.
6. Rollback fácil.
7. Código organizado.

Evitar grandes refatorações.

Preferir evoluções incrementais.

Cada implementação deve ser pequena, revisável e facilmente reversível.
