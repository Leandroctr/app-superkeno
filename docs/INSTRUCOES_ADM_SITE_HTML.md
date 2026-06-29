# INSTRUCOES_ADM_SITE_HTML.md

**Documento:** Instruções para administradores do site/app principal  
**Objetivo:** Exibir um modal ou banner no site do cliente chamando o usuário para instalar o PWA  
**Data:** 2026-06-29  
**Aplica-se a:** Equipe que mantém o site/app principal da plataforma (não o PWA)

---

## 1. Objetivo

O PWA (Progressive Web App) já existe e está disponível em um domínio separado.  
O objetivo deste documento é orientar como exibir um **modal ou banner** no site principal da plataforma convidando o usuário a instalar o PWA no celular ou computador.

Esse modal é apenas uma **chamada de ação** — ele redireciona o usuário para o domínio do PWA, onde a instalação acontece de verdade.

---

## 2. Como funciona a instalação do PWA

> **Importante:** o prompt de instalação nativo do Chrome/Android (`beforeinstallprompt`) só pode ser acionado pelo próprio domínio onde estão o `manifest.webmanifest` e o Service Worker registrado.

Isso significa:

| O que o site principal faz | O que o PWA faz |
|---|---|
| Exibe um modal/banner com botão | Exibe o prompt real de instalação do sistema operacional |
| Redireciona o usuário para o domínio do PWA | Registra o Service Worker e o manifest |
| Controla quando mostrar o convite (localStorage) | Gerencia a instalação no dispositivo do usuário |

**Nunca tente copiar o Service Worker, o manifest ou o OneSignal para o site principal.**  
**Nunca use `iframe` para embutir o PWA dentro do site.**  
Apenas redirecione o usuário para o domínio correto.

---

## 3. Domínios dos PWAs

| Cliente | Domínio do PWA |
|---|---|
| BigPix | `https://pwa.app-bigpix.com` |
| MegaBingo7 | `https://pwa.app-megabingo7.com` |

---

## 4. Código completo — Versão BigPix

Copie o bloco abaixo e cole no HTML do site **BigPix**, antes do `</body>`.

```html
<!-- ================================================== -->
<!-- MODAL DE INSTALAÇÃO DO PWA — BigPix                -->
<!-- Cole antes do </body> no site principal            -->
<!-- ================================================== -->

<!-- Botão flutuante de convite (opcional) -->
<div id="pwa-invite-trigger" style="display:none">
  <button onclick="document.getElementById('pwa-install-modal').style.display='flex'" 
          style="position:fixed;bottom:80px;right:20px;z-index:9998;
                 background:#00b0fe;color:#fff;border:none;border-radius:50px;
                 padding:12px 20px;font-size:14px;font-weight:bold;
                 cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3)">
    📲 Instalar App
  </button>
</div>

<!-- Modal -->
<div id="pwa-install-modal"
     style="display:none;position:fixed;inset:0;z-index:9999;
            background:rgba(0,0,0,0.6);align-items:center;justify-content:center;
            padding:20px;box-sizing:border-box">

  <div style="background:#fff;border-radius:16px;max-width:400px;width:100%;
              padding:32px 24px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3)">

    <!-- Logo ou ícone do app -->
    <img src="https://pwa.app-bigpix.com/icons/icon-192.svg"
         alt="Big Pix"
         width="72" height="72"
         style="border-radius:16px;margin-bottom:16px"
         onerror="this.style.display='none'">

    <h2 style="margin:0 0 8px;font-size:20px;color:#111">Instale o aplicativo Big Pix</h2>

    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.5">
      Acesse a plataforma direto da tela inicial do seu celular,<br>
      sem precisar abrir o navegador toda vez.
    </p>

    <!-- Botão principal -->
    <a href="https://pwa.app-bigpix.com"
       target="_blank"
       rel="noopener noreferrer"
       onclick="pwaInviteDismiss('installed')"
       style="display:block;background:#00b0fe;color:#fff;text-decoration:none;
              border-radius:10px;padding:14px;font-size:15px;font-weight:bold;
              margin-bottom:12px">
      📲 Instalar aplicativo
    </a>

    <!-- Botão secundário -->
    <button onclick="pwaInviteDismiss('dismissed')"
            style="background:none;border:none;color:#888;font-size:13px;
                   cursor:pointer;padding:8px;width:100%">
      Agora não
    </button>
  </div>
</div>

<style>
  @media (prefers-color-scheme: dark) {
    #pwa-install-modal > div {
      background: #1e1e1e;
      color: #fff;
    }
    #pwa-install-modal h2 { color: #fff; }
    #pwa-install-modal p  { color: #aaa; }
    #pwa-install-modal button { color: #888; }
  }
</style>

<script>
  (function () {
    var STORAGE_KEY   = 'pwa_bigpix_invite_dismissed_at';
    var COOLDOWN_MS   = 24 * 60 * 60 * 1000; // 24 horas
    var DELAY_SHOW_MS = 8000;                 // exibir após 8 segundos

    function pwaInviteShouldShow() {
      try {
        var ts = localStorage.getItem(STORAGE_KEY);
        if (!ts) return true;
        return Date.now() - parseInt(ts, 10) > COOLDOWN_MS;
      } catch (e) {
        return false;
      }
    }

    window.pwaInviteDismiss = function (reason) {
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch (e) {}
      document.getElementById('pwa-install-modal').style.display = 'none';
      document.getElementById('pwa-invite-trigger').style.display = 'none';
    };

    function pwaInviteShow() {
      if (!pwaInviteShouldShow()) return;
      document.getElementById('pwa-install-modal').style.display = 'flex';
      document.getElementById('pwa-invite-trigger').style.display = 'block';
    }

    // Fechar ao clicar fora do card
    document.getElementById('pwa-install-modal').addEventListener('click', function (e) {
      if (e.target === this) pwaInviteDismiss('backdrop');
    });

    // Exibir após delay
    setTimeout(pwaInviteShow, DELAY_SHOW_MS);
  })();
</script>
<!-- ================================================== -->
```

---

## 5. Código completo — Versão MegaBingo7

Copie o bloco abaixo e cole no HTML do site **MegaBingo7**, antes do `</body>`.

```html
<!-- ================================================== -->
<!-- MODAL DE INSTALAÇÃO DO PWA — MegaBingo7            -->
<!-- Cole antes do </body> no site principal            -->
<!-- ================================================== -->

<!-- Botão flutuante de convite (opcional) -->
<div id="pwa-invite-trigger" style="display:none">
  <button onclick="document.getElementById('pwa-install-modal').style.display='flex'"
          style="position:fixed;bottom:80px;right:20px;z-index:9998;
                 background:#e00;color:#fff;border:none;border-radius:50px;
                 padding:12px 20px;font-size:14px;font-weight:bold;
                 cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.3)">
    📲 Instalar App
  </button>
</div>

<!-- Modal -->
<div id="pwa-install-modal"
     style="display:none;position:fixed;inset:0;z-index:9999;
            background:rgba(0,0,0,0.6);align-items:center;justify-content:center;
            padding:20px;box-sizing:border-box">

  <div style="background:#fff;border-radius:16px;max-width:400px;width:100%;
              padding:32px 24px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.3)">

    <!-- Logo ou ícone do app -->
    <img src="https://pwa.app-megabingo7.com/icons/icon-192.svg"
         alt="MegaBingo7"
         width="72" height="72"
         style="border-radius:16px;margin-bottom:16px"
         onerror="this.style.display='none'">

    <h2 style="margin:0 0 8px;font-size:20px;color:#111">Instale o MegaBingo7</h2>

    <p style="margin:0 0 24px;font-size:14px;color:#555;line-height:1.5">
      Acesse a plataforma direto da tela inicial do seu celular,<br>
      sem precisar abrir o navegador toda vez.
    </p>

    <!-- Botão principal -->
    <a href="https://pwa.app-megabingo7.com"
       target="_blank"
       rel="noopener noreferrer"
       onclick="pwaInviteDismiss('installed')"
       style="display:block;background:#e00;color:#fff;text-decoration:none;
              border-radius:10px;padding:14px;font-size:15px;font-weight:bold;
              margin-bottom:12px">
      📲 Instalar aplicativo
    </a>

    <!-- Botão secundário -->
    <button onclick="pwaInviteDismiss('dismissed')"
            style="background:none;border:none;color:#888;font-size:13px;
                   cursor:pointer;padding:8px;width:100%">
      Agora não
    </button>
  </div>
</div>

<style>
  @media (prefers-color-scheme: dark) {
    #pwa-install-modal > div {
      background: #1e1e1e;
      color: #fff;
    }
    #pwa-install-modal h2 { color: #fff; }
    #pwa-install-modal p  { color: #aaa; }
    #pwa-install-modal button { color: #888; }
  }
</style>

<script>
  (function () {
    var STORAGE_KEY   = 'pwa_megabingo7_invite_dismissed_at';
    var COOLDOWN_MS   = 24 * 60 * 60 * 1000; // 24 horas
    var DELAY_SHOW_MS = 8000;                 // exibir após 8 segundos

    function pwaInviteShouldShow() {
      try {
        var ts = localStorage.getItem(STORAGE_KEY);
        if (!ts) return true;
        return Date.now() - parseInt(ts, 10) > COOLDOWN_MS;
      } catch (e) {
        return false;
      }
    }

    window.pwaInviteDismiss = function (reason) {
      try {
        localStorage.setItem(STORAGE_KEY, String(Date.now()));
      } catch (e) {}
      document.getElementById('pwa-install-modal').style.display = 'none';
      document.getElementById('pwa-invite-trigger').style.display = 'none';
    };

    function pwaInviteShow() {
      if (!pwaInviteShouldShow()) return;
      document.getElementById('pwa-install-modal').style.display = 'flex';
      document.getElementById('pwa-invite-trigger').style.display = 'block';
    }

    // Fechar ao clicar fora do card
    document.getElementById('pwa-install-modal').addEventListener('click', function (e) {
      if (e.target === this) pwaInviteDismiss('backdrop');
    });

    // Exibir após delay
    setTimeout(pwaInviteShow, DELAY_SHOW_MS);
  })();
</script>
<!-- ================================================== -->
```

---

## 6. Onde inserir no site

Cole o bloco de código **imediatamente antes** da tag de fechamento `</body>` do HTML principal:

```html
    <!-- ... restante do conteúdo da página ... -->

    <!-- MODAL PWA — inserir aqui -->
    <div id="pwa-install-modal"> ... </div>
    <script> ... </script>

  </body>
</html>
```

Se o site for construído com framework (React, Vue, Laravel, WordPress, etc.), insira o código:

| Framework | Onde inserir |
|---|---|
| WordPress | Tema → `footer.php` antes de `</body>`, ou plugin de custom code |
| Laravel/Blade | Layout principal (`layouts/app.blade.php`) antes de `</body>` |
| React/Next.js | Componente `_document.js` ou layout raiz |
| Vue/Nuxt | `layouts/default.vue` |
| HTML puro | Diretamente no `index.html` |

---

## 7. Comportamento do localStorage

| Chave | Valor | Efeito |
|---|---|---|
| `pwa_bigpix_invite_dismissed_at` | timestamp (ms) | Modal não aparece por 24h após fechar |
| `pwa_megabingo7_invite_dismissed_at` | timestamp (ms) | Idem para MegaBingo7 |

- **Primeira visita:** modal abre após 8 segundos.
- **"Agora não":** modal não aparece nas próximas 24 horas.
- **"Instalar aplicativo":** abre o PWA em nova aba e registra o dismiss de 24h.
- **Clicar fora do card:** comporta como "Agora não".
- **Após 24 horas:** modal volta a aparecer na próxima visita.

Para ajustar o delay ou o cooldown, edite as variáveis no topo do `<script>`:
```js
var DELAY_SHOW_MS = 8000;          // tempo até exibir (em ms)
var COOLDOWN_MS   = 24 * 60 * 60 * 1000; // cooldown após fechar (em ms)
```

---

## 8. Personalização

| O que personalizar | Onde |
|---|---|
| Cor do botão principal | atributo `style` do `<a>` (ex: `background:#00b0fe`) |
| Texto do modal | tags `<h2>` e `<p>` |
| Ícone do app | atributo `src` do `<img>` |
| Delay de exibição | variável `DELAY_SHOW_MS` |
| Cooldown após fechar | variável `COOLDOWN_MS` |
| Botão flutuante | bloco `#pwa-invite-trigger` (remover se não quiser) |

---

## 9. Checklist de teste

Antes de publicar no site real, valide:

- [ ] Modal aparece após o delay configurado na primeira visita
- [ ] Clicar em "Agora não" fecha o modal
- [ ] Modal não aparece novamente nos próximos 30 minutos (simular via DevTools → Application → Local Storage → excluir a chave e recarregar)
- [ ] Clicar em "Instalar aplicativo" abre o domínio correto do PWA em nova aba
- [ ] O domínio aberto é o correto: `pwa.app-bigpix.com` ou `pwa.app-megabingo7.com`
- [ ] Fechar clicando no overlay (fundo escuro) também registra o dismiss
- [ ] Em modo escuro (`prefers-color-scheme: dark`) o card fica com fundo escuro
- [ ] O ícone carrega corretamente (ou some sem quebrar o layout se falhar)
- [ ] Nenhum erro aparece no console do navegador
- [ ] Funciona em mobile (Chrome Android) e desktop

---

## 10. Avisos obrigatórios

> ⚠️ **NÃO copie o Service Worker** (`sw.js`) para o site principal.  
> O Service Worker pertence ao domínio do PWA. Copiá-lo para outro domínio não faz a instalação funcionar e pode quebrar o cache do site.

> ⚠️ **NÃO copie o `manifest.webmanifest`** para o site principal.  
> O manifest define o PWA. Ele só tem efeito no domínio onde o Service Worker está registrado.

> ⚠️ **NÃO configure OneSignal no site principal** para este propósito.  
> OneSignal e push notifications estão configurados no PWA. Adicionar uma segunda instância no site principal pode causar conflitos de App ID.

> ⚠️ **NÃO use `<iframe>`** para embutir o PWA dentro do site principal.  
> Iframes bloqueiam a instalação do PWA e criam problemas de segurança (X-Frame-Options, CSP).

> ⚠️ **NÃO altere o fluxo de login ou a plataforma principal** para implementar este modal.  
> O modal é um elemento visual independente — não deve depender de sessão, autenticação ou dados do usuário.

> ⚠️ **NÃO aponte o usuário para o domínio errado.**  
> BigPix → `https://pwa.app-bigpix.com` (nunca `pwa.app-megabingo7.com`)  
> MegaBingo7 → `https://pwa.app-megabingo7.com` (nunca `pwa.app-bigpix.com`)

---

## 11. Referência rápida

| Item | BigPix | MegaBingo7 |
|---|---|---|
| Link do botão | `https://pwa.app-bigpix.com` | `https://pwa.app-megabingo7.com` |
| Chave localStorage | `pwa_bigpix_invite_dismissed_at` | `pwa_megabingo7_invite_dismissed_at` |
| Cor sugerida | `#00b0fe` (azul) | `#e00` (vermelho) |
| Ícone fallback | `/icons/icon-192.svg` no domínio PWA | idem |
