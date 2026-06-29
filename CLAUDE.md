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

Uma implementação não é considerada concluída enquanto a documentação não estiver atualizada.

---

## Arquitetura atual

O projeto está em **transição arquitetural**.

> **Antes:** White label por deploy individual — settings identificados por `singleton_key`.

> **Agora (código):** Multi-tenant por domínio — settings identificados por `tenant_domain`.

> **Bloqueio crítico:** a coluna `tenant_domain` não existe em `supabase/schema.sql`. O código já usa `tenant_domain`, mas o banco não tem a coluna nem o índice único necessário. Resultado: settings sempre em fallback de env vars; painel admin não consegue salvar configurações.

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
