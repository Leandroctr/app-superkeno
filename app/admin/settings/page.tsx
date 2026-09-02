import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminSettingsForm } from "@/components/admin-settings-form";
import { getAppSettings } from "@/lib/app-settings.server";
import { requireTenantAccess } from "@/lib/admin-identity.server";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const currentAdmin = await requireTenantAccess();
  if (!currentAdmin) {
    redirect("/admin/login");
  }

  const settings = await getAppSettings();

  return (
    <main
      className="min-h-dvh px-4 py-6 text-slate-950"
      style={{ backgroundColor: settings.backgroundColor }}
    >
      <section className="mx-auto grid max-w-6xl gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-500">
              {settings.appShortName}
            </p>
            <h1 className="text-2xl font-black tracking-normal">
              Configuracoes white-label
            </h1>
          </div>
          <div className="flex items-center gap-4">
            <Link className="text-sm font-bold text-slate-700" href="/admin">
              Voltar ao painel
            </Link>
            <Link className="text-sm font-bold text-slate-700" href="/">
              Ver splash
            </Link>
          </div>
        </header>

        <AdminSettingsForm initialSettings={settings} />
      </section>
    </main>
  );
}
