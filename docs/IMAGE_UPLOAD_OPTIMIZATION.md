# IMAGE_UPLOAD_OPTIMIZATION.md

**Projeto:** app-big-pwa
**Data:** 2026-06-29
**Arquivo de referência:** `app/api/admin/upload/route.ts`

---

## Objetivo

Otimizar automaticamente imagens enviadas pelo painel admin antes de enviá-las ao Supabase Storage, eliminando a necessidade de compressão manual pelo operador.

---

## Escopo

### Kinds com otimização ativa

| Kind | Dimensão de saída | Fit | Fundo | Formato de saída |
|---|---|---|---|---|
| `icon512` | 512×512 | `contain` | transparente | PNG |
| `icon192` | 192×192 | `contain` | transparente | PNG |
| `favicon` | 32×32 | `contain` | transparente | PNG |
| `logo` | max 800px largura | `inside` + sem ampliar | — | PNG |

### Kinds sem otimização (passam como estão)

| Kind | Motivo |
|---|---|
| `splash` | Excluído desta fase — pode ser adicionado futuramente |
| `splashHtml` | Arquivo HTML — não é imagem |

### Formatos que bypassam o sharp

| Extensão | Motivo |
|---|---|
| `.svg` | Formato vetorial — sharp não produz SVG |
| `.ico` | Formato container — sharp não produz ICO |

Esses formatos passam pela validação de tamanho original normalmente.

---

## Pipeline de processamento

```
POST /api/admin/upload
  │
  ├─ Validação de autenticação
  ├─ Validação de extensão / MIME type (inalterada)
  │
  ├─ [se kind ∈ {icon512, icon192, favicon, logo} e não SVG/ICO]
  │     └─ sharp: redimensionar + converter para PNG otimizado
  │           compressionLevel: 9, adaptiveFiltering: true
  │
  ├─ Validação de tamanho (sobre buffer otimizado, se aplicável)
  │     └─ se ainda exceder o limite → HTTP 400 com mensagem específica
  │
  ├─ Upload para Supabase Storage
  └─ Retorno JSON com metadados de otimização
```

---

## Configuração do sharp

```typescript
// PNG máxima compressão sem perda de qualidade
const pngOptions = { compressionLevel: 9, adaptiveFiltering: true };

// icon512 / icon192 / favicon
sharp(input)
  .resize(W, H, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png(pngOptions)

// logo
sharp(input)
  .resize(800, undefined, { fit: "inside", withoutEnlargement: true })
  .png(pngOptions)
```

---

## Resposta JSON

### Quando otimizado

```json
{
  "ok": true,
  "url": "https://...",
  "path": "icon512/...",
  "originalSizeKb": 234,
  "optimizedSizeKb": 45,
  "optimized": true,
  "width": 512,
  "height": 512
}
```

### Quando não otimizado (SVG, ICO, splash, splashHtml)

```json
{
  "ok": true,
  "url": "https://...",
  "path": "splash/...",
  "originalSizeKb": 180,
  "optimizedSizeKb": 180,
  "optimized": false,
  "width": null,
  "height": null
}
```

### Quando excede o limite após otimização

```json
{
  "ok": false,
  "error": "Imagem otimizada ainda excede o limite de 500 KB."
}
```

---

## Limites de tamanho (após otimização)

| Kind | Limite |
|---|---|
| `logo` | 500 KB |
| `favicon` | 100 KB |
| `icon192` | 300 KB |
| `icon512` | 500 KB |
| `splash` | 1 MB |
| `splashHtml` | 500 KB |

---

## Dependência

- **Pacote:** `sharp` (instalado em `dependencies`)
- **Runtime:** Node.js — funciona em Vercel Fluid Compute (sem edge runtime)
- **Versão mínima testada:** 0.34.x

---

## Comportamento de fallback

Se o `sharp` lançar exceção durante o processamento (ex: arquivo corrompido), a rota faz fallback para o buffer original sem otimização e prossegue com a validação de tamanho normal. O erro é logado com `console.error`.

---

## Rollback

Remover o import de `sharp`, restaurar a rota original (sem pipeline de otimização) e desinstalar o pacote:

```bash
npm uninstall sharp
```

O arquivo de rollback de referência é o commit anterior a este.

---

## O que não muda

- Validação de extensão e MIME type
- Fluxo de autenticação
- Lógica de `splashHtml`
- Nomes de campos no formulário admin
- Schema SQL
- Service Worker
- OneSignal
- tenant_domain
