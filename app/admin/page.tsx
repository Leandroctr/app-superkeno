import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPushForm } from "@/components/admin-push-form";
import { clearAdminSession, isAdminAuthenticated } from "@/lib/admin-auth";
import { appConfig } from "@/lib/app-config";
import { getAppSettings } from "@/lib/app-settings.server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type SubscriptionRow = {
  id: string;
  onesignal_id: string;
  permission_status: string | null;
  device_type: string | null;
  created_at: string;
  last_seen_at: string | null;
};

type CampaignRow = {
  id: string;
  title: string;
  target_type: string;
  status: string;
  recipient_count: number | null;
  created_at: string;
  sent_at: string | null;
};

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

async function logout() {
  "use server";

  await clearAdminSession();
  redirect("/admin/login");
}

export default async function AdminPage() {
  if (!(await isAdminAuthenticated())) {
    redirect("/admin/login");
  }

  const supabase = createSupabaseAdminClient();
  const settings = await getAppSettings();
  let totalSubscriptions = 0;
  let subscriptions: SubscriptionRow[] = [];
  let campaigns: CampaignRow[] = [];
  let configWarning = "";

  if (!supabase) {
    configWarning = "Supabase nao configurado.";
  } else {
    const [countResult, subscriptionsResult, campaignsResult] = await Promise.all([
      supabase
        .from("push_subscriptions")
        .select("*", { count: "exact", head: true })
        .eq("tenant_domain", settings.tenantDomain),
      supabase
        .from("push_subscriptions")
        .select("id, onesignal_id, permission_status, device_type, created_at, last_seen_at")
        .eq("tenant_domain", settings.tenantDomain)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("push_campaigns")
        .select("id, title, target_type, status, recipient_count, created_at, sent_at")
        .eq("tenant_domain", settings.tenantDomain)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    totalSubscriptions = countResult.count || 0;
    subscriptions = subscriptionsResult.data || [];
    campaigns = campaignsResult.data || [];

    if (countResult.error || subscriptionsResult.error || campaignsResult.error) {
      configWarning = "Nao foi possivel carregar todos os dados do painel.";
    }
  }

  return (
    <main
      className="min-h-dvh px-4 py-6 text-slate-950"
      style={{ backgroundColor: appConfig.backgroundColor }}
    >
      <section className="mx-auto grid max-w-5xl gap-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-slate-500">
              {appConfig.shortName}
            </p>
            <h1 className="text-2xl font-black tracking-normal">Painel Admin</h1>
          </div>
          <div className="flex items-center gap-4">
            <Link className="text-sm font-bold text-slate-700" href="/admin/settings">
              Configuracoes
            </Link>
            <Link className="text-sm font-bold text-slate-700" href="/">
              Ver home
            </Link>
            <form action={logout}>
              <button className="text-sm font-bold text-slate-700" type="submit">
                Sair
              </button>
            </form>
          </div>
        </header>

        {configWarning ? (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
            {configWarning}
          </p>
        ) : null}

        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <section className="rounded-lg bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">
              Total de inscritos
            </p>
            <p className="mt-3 text-4xl font-black">{totalSubscriptions}</p>
          </section>

          <section className="rounded-lg bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-black">Enviar push</h2>
            <AdminPushForm />
          </section>
        </div>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-black">Ultimos inscritos</h2>
          <div className="grid gap-3">
            {subscriptions.length > 0 ? (
              subscriptions.map((item) => (
                <div
                  className="grid gap-1 border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0"
                  key={item.id}
                >
                  <p className="break-all font-semibold text-slate-900">
                    {item.onesignal_id}
                  </p>
                  <p className="text-slate-500">
                    {item.permission_status || "-"} | {item.device_type || "-"} |{" "}
                    {formatDate(item.last_seen_at || item.created_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Nenhum inscrito ainda.</p>
            )}
          </div>
        </section>

        <section className="rounded-lg bg-white p-5 shadow-sm">
          <h2 className="mb-4 text-lg font-black">Historico de campanhas</h2>
          <div className="grid gap-3">
            {campaigns.length > 0 ? (
              campaigns.map((item) => (
                <div
                  className="grid gap-1 border-b border-slate-100 pb-3 text-sm last:border-0 last:pb-0"
                  key={item.id}
                >
                  <p className="font-semibold text-slate-900">{item.title}</p>
                  <p className="text-slate-500">
                    {item.status} | {item.target_type} |{" "}
                    {item.recipient_count || 0} destinatarios |{" "}
                    {formatDate(item.sent_at || item.created_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Nenhuma campanha enviada.</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
