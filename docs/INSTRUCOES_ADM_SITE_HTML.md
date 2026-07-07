# Instrucoes para banner Clube VIP no site principal

**Marca:** Super Keno
**PWA:** `https://pwa.app-superkeno.com`
**Arquivo para envio:** `INSTRUCOES_BANNER_CLUBE_VIP_SUPERKENO.md`

## Objetivo

Adicionar uma faixa simples no topo do site principal convidando o usuario a acessar o PWA da Super Keno.

O site principal apenas redireciona para o PWA. Ele normalmente nao dispara o prompt nativo de instalacao, porque esse prompt depende do dominio onde estao o manifest e o Service Worker do PWA.

## Onde inserir

Cole o snippet abaixo no HTML do site principal, preferencialmente imediatamente antes de `</body>` ou no ponto equivalente do template global.

Nao copie Service Worker, manifest, OneSignal, assets do PWA ou qualquer configuracao de push para o site principal. Nao use iframe.

## Snippet HTML/CSS/JS

```html
<!-- Banner Clube VIP - Super Keno -->
<div id="vip-install-banner" class="vip-install-banner vip-install-banner--expanded" role="region" aria-label="Clube VIP">
  <div class="vip-install-banner__content">
    <img
      class="vip-install-banner__logo"
      src="https://pwa.app-superkeno.com/icons/icon-192.svg"
      alt="Super Keno"
      width="40"
      height="40"
      onerror="this.style.display='none'"
    >

    <div class="vip-install-banner__text">
      <strong>Entre para o Clube VIP 👑</strong>
      <span>Instale o app e receba promoções especiais, bônus exclusivos e vantagens reservadas para quem faz parte.</span>
    </div>

    <a class="vip-install-banner__cta" href="https://pwa.app-superkeno.com" target="_blank" rel="noopener noreferrer">
      Instalar app
    </a>

    <button class="vip-install-banner__later" type="button" data-vip-collapse>
      Depois
    </button>

    <button class="vip-install-banner__close" type="button" aria-label="Recolher banner" data-vip-collapse>
      ×
    </button>
  </div>

  <a class="vip-install-banner__mini" href="https://pwa.app-superkeno.com" target="_blank" rel="noopener noreferrer">
    <span>Clube VIP 👑 Instale o app e receba vantagens exclusivas.</span>
    <strong>Instalar</strong>
  </a>
</div>

<style>
  .vip-install-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 9999;
    font-family: Arial, sans-serif;
    color: #111827;
  }

  .vip-install-banner__content,
  .vip-install-banner__mini {
    box-sizing: border-box;
    width: 100%;
    background: #ffffff;
    border-bottom: 1px solid rgba(17, 24, 39, 0.12);
    box-shadow: 0 8px 24px rgba(17, 24, 39, 0.14);
  }

  .vip-install-banner__content {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
  }

  .vip-install-banner__logo {
    flex: 0 0 auto;
    border-radius: 10px;
  }

  .vip-install-banner__text {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: column;
    gap: 2px;
    font-size: 14px;
    line-height: 1.35;
  }

  .vip-install-banner__text strong {
    font-size: 15px;
  }

  .vip-install-banner__text span {
    color: #4b5563;
  }

  .vip-install-banner__cta,
  .vip-install-banner__mini strong {
    background: #006DFF;
    color: #ffffff;
    text-decoration: none;
    border-radius: 999px;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 700;
    white-space: nowrap;
  }

  .vip-install-banner__later,
  .vip-install-banner__close {
    border: 0;
    background: transparent;
    color: #4b5563;
    cursor: pointer;
    font: inherit;
  }

  .vip-install-banner__close {
    width: 32px;
    height: 32px;
    font-size: 24px;
    line-height: 1;
  }

  .vip-install-banner__mini {
    display: none;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 7px 12px;
    color: #111827;
    text-align: center;
    text-decoration: none;
    font-size: 13px;
  }

  .vip-install-banner--collapsed .vip-install-banner__content {
    display: none;
  }

  .vip-install-banner--collapsed .vip-install-banner__mini {
    display: flex;
  }

  @media (max-width: 640px) {
    .vip-install-banner__content {
      align-items: flex-start;
      flex-wrap: wrap;
      padding: 10px 12px;
    }

    .vip-install-banner__text {
      flex-basis: calc(100% - 92px);
    }

    .vip-install-banner__cta {
      flex: 1 1 auto;
      text-align: center;
    }

    .vip-install-banner__later {
      padding: 10px 8px;
    }

    .vip-install-banner__mini {
      justify-content: space-between;
      text-align: left;
    }
  }
</style>

<script>
  (function () {
    var banner = document.getElementById('vip-install-banner');
    var AUTO_COLLAPSE_MS = 7000;

    if (!banner) return;

    function collapseBanner() {
      banner.classList.remove('vip-install-banner--expanded');
      banner.classList.add('vip-install-banner--collapsed');
    }

    var collapseButtons = banner.querySelectorAll('[data-vip-collapse]');
    for (var i = 0; i < collapseButtons.length; i += 1) {
      collapseButtons[i].addEventListener('click', collapseBanner);
    }

    window.setTimeout(collapseBanner, AUTO_COLLAPSE_MS);
  })();
</script>
```

## Campos editaveis

| Campo | Valor atual |
|---|---|
| `BRAND_NAME` | `Super Keno` |
| `PWA_URL` | `https://pwa.app-superkeno.com` |
| `LOGO_URL` | `https://pwa.app-superkeno.com/icons/icon-192.svg` |
| `CTA_COLOR` | `#006DFF` |

`LOGO_URL` esta usando fallback temporario do icone PWA. O administrador do site principal deve trocar `LOGO_URL` pela URL oficial do logo da marca quando disponivel.

Nunca reaproveite logo BigPix em outros tenants. Nunca reaproveite logo de outro tenant sem conferir o branding.

## Cuidados criticos

- O banner nao deve pedir notificacoes.
- O site principal nao deve receber Service Worker, manifest ou OneSignal para esta acao.
- O PWA nao deve ser embutido por iframe.
- O clique no botao ou na faixa recolhida deve apontar para `https://pwa.app-superkeno.com`.
- A faixa recolhida deve continuar visivel, discreta e clicavel.

## Adaptacao futura por tenant

Para outro tenant, altere somente `BRAND_NAME`, `PWA_URL`, `LOGO_URL`, textos se necessario e a chave visual da marca. Confira o dominio final antes de publicar.

Após aplicar o snippet no site principal, avise a equipe responsável para validação em mobile antes da publicação final.
