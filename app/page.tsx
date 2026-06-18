import Image from "next/image";
import { NotificationButton } from "@/components/notification-button";
import { appConfig } from "@/lib/app-config";

export default function Home() {
  const appInitial = appConfig.shortName.trim().charAt(0).toUpperCase() || "A";

  return (
    <main
      className="min-h-dvh text-slate-950"
      style={
        {
          "--app-primary": appConfig.themeColor,
          "--app-background": appConfig.backgroundColor,
          backgroundColor: "var(--app-background)",
        } as React.CSSProperties
      }
    >
      <section className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-6 pt-5">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {appConfig.logoUrl ? (
              <Image
                alt={`${appConfig.name} logo`}
                className="size-11 rounded-2xl object-cover shadow-lg shadow-slate-900/20"
                height={44}
                src={appConfig.logoUrl}
                width={44}
              />
            ) : (
              <div
                className="grid size-11 place-items-center rounded-2xl text-lg font-bold text-white shadow-lg shadow-slate-900/20"
                style={{ backgroundColor: "var(--app-primary)" }}
              >
                {appInitial}
              </div>
            )}
            <div>
              <p className="text-sm font-medium text-slate-500">
                {appConfig.home.eyebrow}
              </p>
              <h1 className="text-xl font-bold tracking-normal">
                {appConfig.name}
              </h1>
            </div>
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center py-10">
          <div
            className="mb-7 overflow-hidden rounded-[2rem] p-5 text-white shadow-2xl shadow-slate-900/20"
            style={{ backgroundColor: "var(--app-primary)" }}
          >
            <div className="mb-12 flex items-center justify-between">
              <span className="rounded-full bg-white/12 px-3 py-1 text-xs font-semibold">
                {appConfig.mode}
              </span>
              <span className="text-xs text-white/65">{appConfig.shortName}</span>
            </div>
            <p className="max-w-64 text-3xl font-black leading-tight tracking-normal">
              {appConfig.description}
            </p>
            <div className="mt-8 rounded-2xl bg-white/10 p-4">
              <p className="text-sm leading-6 text-white/75">
                {appConfig.name}
              </p>
            </div>
          </div>

          <p className="mb-6 text-base leading-7 text-slate-600">
            {appConfig.description}
          </p>

          <div className="grid gap-3">
            <a
              className="flex min-h-14 items-center justify-center rounded-2xl px-5 text-base font-bold text-white shadow-lg shadow-slate-900/20 transition hover:brightness-95 focus:outline-none focus:ring-4 focus:ring-slate-200"
              href={appConfig.platformUrl}
              style={{ backgroundColor: "var(--app-primary)" }}
            >
              {appConfig.home.primaryActionLabel}
            </a>
            <a
              className="flex min-h-14 items-center justify-center rounded-2xl border border-slate-200 bg-white px-5 text-base font-bold text-slate-800 shadow-sm transition hover:border-slate-300 focus:outline-none focus:ring-4 focus:ring-slate-200"
              href={appConfig.supportUrl}
            >
              {appConfig.home.supportActionLabel}
            </a>
            <NotificationButton themeColor={appConfig.themeColor} />
          </div>
        </div>

        <a
          aria-label="Abrir suporte"
          className="fixed bottom-5 right-5 grid size-14 place-items-center rounded-full text-xl font-black text-white shadow-xl shadow-slate-900/25 transition hover:scale-105 focus:outline-none focus:ring-4 focus:ring-slate-300"
          href={appConfig.supportUrl}
          style={{ backgroundColor: "var(--app-primary)" }}
        >
          {appConfig.home.supportFloatingLabel}
        </a>
      </section>
    </main>
  );
}
