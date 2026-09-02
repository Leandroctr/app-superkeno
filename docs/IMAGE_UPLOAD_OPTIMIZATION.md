# Segurança e processamento de uploads

**Projeto:** app-big-pwa

**Atualizado em:** 2026-09-01

**Arquivos de referência:** `app/api/admin/upload/route.ts` e
`lib/upload-security.server.ts`

---

## Objetivo

O endpoint administrativo aceita somente imagens raster realmente suportadas,
valida o conteúdo antes de gravá-lo e processa todo arquivo aceito com Sharp.
Nenhum arquivo fornecido pelo cliente é armazenado diretamente.

## Kinds permitidos

O conjunto é fechado e tipado:

| Kind | Limite do arquivo de entrada e da saída | Processamento | Saída |
|---|---:|---|---|
| `logo` | 500 KB | largura máxima de 800 px, sem ampliar | PNG |
| `favicon` | 100 KB | 32x32, `contain`, fundo transparente | PNG |
| `icon192` | 300 KB | 192x192, `contain`, fundo transparente | PNG |
| `icon512` | 500 KB | 512x512, `contain`, fundo transparente | PNG |
| `splash` | 1 MB | decodificação e reencode, sem resize | preserva PNG/JPEG/WEBP |

Qualquer outro valor, inclusive vazio, `asset`, `splashHtml`, traversal ou
prefixo arbitrário, retorna HTTP 400. O `kind` só chega ao path do Storage
depois dessa validação.

## Formatos

São aceitos somente:

- PNG com assinatura PNG, extensão `.png` e MIME `image/png`;
- JPEG com assinatura JPEG, extensão `.jpg` ou `.jpeg` e MIME `image/jpeg`;
- WEBP com container RIFF/WEBP, extensão `.webp` e MIME `image/webp`.

Extensão, MIME declarado e assinatura precisam concordar. Depois disso, Sharp
precisa decodificar e regravar a imagem por completo. Falha de decode,
truncamento, corrupção, imagem acima de 40 milhões de pixels ou saída acima do
limite são rejeitados. Não existe fallback para os bytes originais.

SVG, HTML, GIF e ICO são reconhecidos pela inspeção inicial apenas para serem
rejeitados. SVG e ICO não possuem uso ativo entre os assets configurados dos
seis tenants; GIF nunca fez parte do fluxo suportado.

## Splash HTML legado

Novos uploads HTML estão desativados no endpoint e na interface. BigPix e
MegaBingo7 ainda possuem splash HTML legado ativo, com scripts e animações, por
isso os URLs existentes continuam sendo consumidos sob o sandbox já endurecido
em C-2. O salvamento de settings aceita somente preservar exatamente o URL
tenant-scoped já gravado ou removê-lo; um URL HTML novo retorna HTTP 400.

## Pipeline

```text
POST /api/admin/upload
  -> requireTenantAccess()
  -> Content-Length global <= 1 MB + 64 KB de overhead
  -> Content-Type multipart/form-data
  -> request.formData()
  -> kind na whitelist fechada
  -> File presente e tamanho bruto <= limite do kind
  -> arrayBuffer()
  -> assinatura real + extensão + MIME coerentes
  -> Sharp: decode completo + resize/reencode
  -> tamanho processado <= limite do kind
  -> path gerado com kind validado, timestamp, UUID e nome normalizado
  -> Blob binário -> bucket app-assets
  -> getPublicUrl(path)
```

O limite por `Content-Length` impede que requests obviamente grandes cheguem a
`request.formData()`. Se o header estiver ausente ou declarar um tamanho menor
que o corpo real, o runtime do Next ainda materializa o multipart antes de o
código conseguir validar `File.size`. Corrigir integralmente essa limitação
exigiria um parser multipart streaming e foi deliberadamente evitado nesta
etapa para não introduzir uma refatoração complexa.

## Storage

Esta remediação não altera bucket, `public`, `file_size_limit`,
`allowed_mime_types`, policies ou grants. O upload continua com
`cacheControl: 31536000`, `upsert: false` e gera a URL pública pelo mesmo
`getPublicUrl(path)`.

## Dependências

Nenhuma dependência foi adicionada. O Sharp direto já existente (`^0.35.2`) faz
o decode e reencode; as assinaturas do conjunto pequeno e fechado são validadas
por código local explícito.

## Rollback

Reverter em conjunto a rota, o helper, a proteção de `splashHtmlUrl`, a
interface e os testes desta etapa. Não há migration nem mudança de dados para
desfazer.
