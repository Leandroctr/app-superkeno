"use client";

import Image from "next/image";
import { useEffect, useMemo } from "react";
import type { CSSProperties } from "react";
import { NotificationButton } from "@/components/notification-button";
import { appConfig } from "@/lib/app-config";

const REDIRECT_DELAY_MS = 1500;

function isValidPlatformUrl(url: string) {
  return Boolean(url.trim()) && url.trim() !== "#";
}

export default function Home() {
  const canRedirect = isValidPlatformUrl(appConfig.platformUrl);
  const hasPlatformError = !canRedirect;
  const appInitial = appConfig.shortName.trim().charAt(0).toUpperCase() || "A";

  const rootStyle = useMemo(
    () =>
      ({
        "--app-primary": appConfig.themeColor,
        "--app-background": appConfig.backgroundColor,
        backgroundColor: "var(--app-background)",
      }) as CSSProperties,
    [],
  );

  useEffect(() => {
    if (!canRedirect) {
      return;
    }

    const timer = window.setTimeout(() => {
      window.location.assign(appConfig.platformUrl);
    }, REDIRECT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [canRedirect]);

  return (
    <main
      className="grid min-h-dvh place-items-center px-5 py-8 text-slate-950"
      style={rootStyle}
    >
      <section className="flex w-full max-w-sm flex-col items-center text-center">
        <div className="mb-6">
          {appConfig.logoUrl ? (
            <Image
              alt={`${appConfig.name} logo`}
              className="size-20 rounded-3xl object-cover shadow-xl shadow-slate-900/15"
              height={80}
              priority
              src={appConfig.logoUrl}
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

        <h1 className="text-2xl font-bold tracking-normal">{appConfig.name}</h1>
        <p className="mt-3 text-sm font-medium leading-6 text-slate-600">
          {hasPlatformError
            ? "Nao foi possivel abrir a plataforma automaticamente."
            : "Carregando ambiente seguro..."}
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
            aria-disabled={!canRedirect}
            className="rounded-full px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-slate-900/15 transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-slate-200 aria-disabled:pointer-events-none aria-disabled:opacity-60"
            href={canRedirect ? appConfig.platformUrl : "#"}
            style={{ backgroundColor: "var(--app-primary)" }}
          >
            Abrir agora
          </a>

          <a
            className="text-sm font-semibold text-slate-500 underline-offset-4 transition hover:text-slate-800 hover:underline focus:outline-none focus:ring-4 focus:ring-slate-200"
            href={appConfig.supportUrl || "#"}
          >
            Suporte
          </a>

          <details className="group mt-2 text-left">
            <summary className="cursor-pointer list-none text-center text-xs font-semibold text-slate-400 transition hover:text-slate-600">
              Notificacoes
            </summary>
            <div className="mt-3 w-64">
              <NotificationButton themeColor={appConfig.themeColor} />
            </div>
          </details>
        </div>
      </section>
    </main>
  );
}
