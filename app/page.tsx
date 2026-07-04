"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { NotificationButton } from "@/components/notification-button";
import { appConfigClient } from "@/lib/app-config.client";
import type { AppSettings } from "@/lib/app-settings";

function isValidPlatformUrl(url: string) {
  return Boolean(url.trim()) && url.trim() !== "#";
}

function prepareHtml(html: string, platformUrl: string, redirectDelayMs: number): string {
  const W = 1080;
  const H = 1920;

  // Remove any existing viewport meta so ours is the only one
  const cleaned = html.replace(/<meta[^>]+name=["']viewport["'][^>]*\/?>/gi, "");

  const redirectJs = platformUrl
    ? `window.setTimeout(function(){window.top.location.assign(${JSON.stringify(platformUrl)});},${redirectDelayMs});`
    : "";

  const inject = `<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
html{margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;}
body{margin:0;padding:0;width:${W}px;height:${H}px;overflow:hidden;transform-origin:0 0;opacity:0;}
</style>
<script>(function(){function s(){var w=window.innerWidth,h=window.innerHeight,f=Math.max(w/${W},h/${H}),tx=(w-${W}*f)/2,ty=(h-${H}*f)/2;document.body.style.transform='translateX('+tx+'px) translateY('+ty+'px) scale('+f+')';document.body.style.opacity='1';}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',s);}else{s();}window.addEventListener('resize',s);${redirectJs}})()</script>`;

  if (/<head[^>]*>/i.test(cleaned)) {
    return cleaned.replace(/<head([^>]*)>/i, (_, attrs: string) => `<head${attrs}>\n${inject}`);
  }
  return `<head>\n${inject}</head>\n${cleaned}`;
}

type PlatformState = {
  mounted: boolean;
  isValid: boolean;
  url: string;
};

function resolveSplashIconUrl(settings: AppSettings): string | undefined {
  return (
    settings.splashImageUrl ||
    settings.logoUrl ||
    settings.icon512Url ||
    settings.icon192Url ||
    undefined
  );
}

function getClientFallbackSettings(): AppSettings {
  return {
    appName: appConfigClient.appName,
    appShortName: appConfigClient.appShortName,
    appDescription: appConfigClient.appDescription,
    platformUrl: appConfigClient.platformUrl,
    supportUrl: appConfigClient.supportUrl,
    publicUrl: appConfigClient.publicUrl,
    logoUrl: appConfigClient.logoUrl,
    icon192Url: "/icons/icon-192.svg",
    icon512Url: "/icons/icon-512.svg",
    faviconUrl: "",
    themeColor: appConfigClient.themeColor,
    backgroundColor: appConfigClient.backgroundColor,
    splashTitle: appConfigClient.appName,
    splashMessage: "Carregando ambiente seguro...",
    splashImageUrl: appConfigClient.splashImageUrl,
    splashHtmlUrl: "",
    redirectDelayMs: 1500,
    notificationsEnabled: false,
    oneSignalAppId: appConfigClient.oneSignalAppId,
  };
}

export default function Home() {
  const [settings, setSettings] = useState<AppSettings>(getClientFallbackSettings);
  const [splashHtml, setSplashHtml] = useState("");
  const [platformState, setPlatformState] = useState<PlatformState>({
    mounted: false,
    isValid: false,
    url: "",
  });
  const hasPlatformError = platformState.mounted && !platformState.isValid;
  const splashIconUrl = resolveSplashIconUrl(settings);
  const appInitial =
    settings.appShortName.trim().charAt(0).toUpperCase() ||
    settings.appName.trim().charAt(0).toUpperCase() ||
    "A";

  const rootStyle = useMemo(
    () =>
      ({
        "--app-primary": settings.themeColor,
        "--app-background": settings.backgroundColor,
        backgroundColor: "var(--app-background)",
        backgroundImage: settings.splashImageUrl
          ? `linear-gradient(rgba(246, 247, 251, 0.86), rgba(246, 247, 251, 0.92)), url("${settings.splashImageUrl}")`
          : undefined,
        backgroundPosition: "center",
        backgroundSize: "cover",
      }) as CSSProperties,
    [settings.backgroundColor, settings.splashImageUrl, settings.themeColor],
  );

  useEffect(() => {
    let isActive = true;
    let validationTimer: number | undefined;
    let redirectTimer: number | undefined;

    async function loadSettings() {
      let loadedSettings = getClientFallbackSettings();

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch("/api/settings", {
            cache: "no-store",
            signal: controller.signal,
          });
          const result = await response.json();
          if (response.ok && result?.settings) {
            loadedSettings = result.settings;
          }
        } finally {
          window.clearTimeout(timeoutId);
        }
      } catch {
        loadedSettings = getClientFallbackSettings();
      }

      if (loadedSettings.splashHtmlUrl) {
        console.log("[SPLASH] Buscando HTML da splash:", loadedSettings.splashHtmlUrl);
        try {
          const htmlResponse = await fetch(loadedSettings.splashHtmlUrl);
          if (!htmlResponse.ok) {
            throw new Error(`HTTP ${htmlResponse.status}`);
          }
          const html = await htmlResponse.text();
          if (isActive) {
            const pUrl = loadedSettings.platformUrl.trim();
            setSplashHtml(prepareHtml(
              html,
              isValidPlatformUrl(pUrl) ? pUrl : "",
              loadedSettings.redirectDelayMs,
            ));
            console.log("[SPLASH] HTML carregado, tamanho:", html.length, "chars");
          }
        } catch (err) {
          console.warn("[SPLASH] Falha ao buscar HTML da splash, usando splash estatica:", err);
        }
      }

      if (!isActive) {
        return;
      }

      const platformUrl = loadedSettings.platformUrl.trim();
      const isValid = isValidPlatformUrl(platformUrl);
      setSettings(loadedSettings);

      validationTimer = window.setTimeout(() => {
        setPlatformState({
          mounted: true,
          isValid,
          url: platformUrl,
        });
      }, 0);

      if (isValid && !loadedSettings.splashHtmlUrl) {
        redirectTimer = window.setTimeout(() => {
          window.location.assign(platformUrl);
        }, loadedSettings.redirectDelayMs);
      }
    }

    loadSettings();

    return () => {
      isActive = false;
      window.clearTimeout(validationTimer);
      window.clearTimeout(redirectTimer);
    };
  }, []);

  if (splashHtml) {
    console.log("[SPLASH] Renderizando splash HTML via srcDoc");
    return (
      <iframe
        sandbox="allow-scripts allow-same-origin allow-top-navigation"
        srcDoc={splashHtml}
        style={{ display: "block", position: "fixed", inset: 0, margin: 0, width: "100%", height: "100%", border: 0 }}
        title="Splash animada"
      />
    );
  }

  if (!platformState.mounted) {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: settings.themeColor || "#000",
        }}
      />
    );
  }

  console.log("[SPLASH] Renderizando splash estatica");
  return (
    <main
      className="grid min-h-dvh place-items-center px-5 py-8 text-slate-950"
      style={rootStyle}
    >
      <section className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-6">
          {splashIconUrl ? (
            <Image
              alt={`${settings.appName} logo`}
              className="size-20 rounded-3xl object-cover shadow-xl shadow-slate-900/15"
              height={80}
              priority
              src={splashIconUrl}
              unoptimized
              width={80}
            />
          ) : (
            <div
              className="grid size-20 place-items-center rounded-3xl text-3xl font-bold text-white shadow-xl shadow-slate-900/15"
              style={{ backgroundColor: "var(--app-primary)" }}
            >
              {appInitial}
            </div>
          )}
        </div>

        <h1 className="text-2xl font-bold tracking-normal">
          {settings.splashTitle || settings.appName}
        </h1>
        <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
          {hasPlatformError
            ? "Nao foi possivel abrir a plataforma automaticamente."
            : settings.splashMessage || "Carregando ambiente seguro..."}
        </p>

        <div
          aria-hidden="true"
          className="mt-7 size-9 animate-spin rounded-full border-4 border-slate-200"
          style={{ borderTopColor: "var(--app-primary)" }}
        />

        {hasPlatformError ? (
          <p className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium leading-6 text-amber-900">
            A URL da plataforma ainda nao foi configurada. Verifique
            NEXT_PUBLIC_PLATFORM_URL no ambiente deste PWA.
          </p>
        ) : null}

        <div className="mt-8 flex flex-col items-center gap-4">
          <a
            aria-disabled={!platformState.isValid}
            className="rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-900/15 transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-slate-200 aria-disabled:pointer-events-none aria-disabled:opacity-60"
            href={platformState.isValid ? platformState.url : "#"}
            style={{ backgroundColor: "var(--app-primary)" }}
          >
            Abrir agora
          </a>

          <a
            className="text-sm font-semibold text-slate-500 underline-offset-4 transition hover:text-slate-800 hover:underline focus:outline-none focus:ring-4 focus:ring-slate-200"
            href={settings.supportUrl || "#"}
          >
            Suporte
          </a>

          {settings.notificationsEnabled ? (
            <details className="group mt-2 text-left">
              <summary className="cursor-pointer list-none text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">
                Notificacoes
              </summary>
              <div className="mt-3 w-64">
                <NotificationButton themeColor={settings.themeColor} />
              </div>
            </details>
          ) : null}
        </div>
      </section>
    </main>
  );
}
