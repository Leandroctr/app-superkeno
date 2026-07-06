import { redirect } from "next/navigation";
import { appConfig } from "@/lib/app-config";
import { createAdminSession, validateAdminCredentials } from "@/lib/admin-auth";
import { createSupabaseSessionClient } from "@/lib/supabase/admin-session";
import { logServerInfo, logServerWarn } from "@/lib/logger/server";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

// Tenta autenticar via Supabase Auth (e-mail/senha). So prova a identidade
// junto ao Supabase Auth — a checagem de papel/tenant (admin_users,
// admin_tenant_access) e feita pelo guard de cada pagina/rota
// (requireTenantAccess()), nao aqui.
async function tryLoginWithSupabaseAuth(email: string, password: string) {
  const supabase = await createSupabaseSessionClient();

  if (!supabase) {
    return false;
  }

  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return !error;
  } catch (err) {
    logServerWarn("admin_login_supabase_auth_error", {
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function login(formData: FormData) {
  "use server";

  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");

  const supabaseOk = await tryLoginWithSupabaseAuth(email, password);

  if (supabaseOk) {
    // Sessao Supabase Auth criada (cookies sb-*). /admin e /admin/settings ja
    // usam requireTenantAccess(), entao essa sessao real basta para entrar —
    // nao precisa (nem deve) passar pelo cookie legado. Quem nao tiver linha
    // em admin_users (ou nao tiver acesso a este tenant_domain) e barrado
    // pelo proprio guard de /admin, nao aqui.
    logServerInfo("admin_login_supabase_auth_ok", { email });
    redirect("/admin");
  }

  if (!validateAdminCredentials(email, password)) {
    redirect("/admin/login?error=1");
  }

  logServerWarn("admin_login_legacy_fallback_used", { email });
  await createAdminSession();
  redirect("/admin");
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const hasError = params.error === "1";

  return (
    <main
      className="grid min-h-dvh place-items-center px-5 py-8 text-slate-950"
      style={{ backgroundColor: appConfig.backgroundColor }}
    >
      <section className="w-full max-w-sm">
        <div className="mb-8">
          <p className="text-sm font-semibold text-slate-500">
            {appConfig.shortName}
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-normal">
            Admin MVP
          </h1>
        </div>

        <form action={login} className="grid gap-4 rounded-lg bg-white p-5 shadow-sm">
          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            Email
            <input
              autoComplete="email"
              className="min-h-12 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
              name="email"
              required
              type="email"
            />
          </label>

          <label className="grid gap-2 text-sm font-semibold text-slate-700">
            Senha
            <input
              autoComplete="current-password"
              className="min-h-12 rounded-lg border border-slate-200 px-3 text-base font-normal outline-none focus:border-slate-400"
              name="password"
              required
              type="password"
            />
          </label>

          <button
            className="min-h-12 rounded-lg px-4 text-base font-bold text-white"
            style={{ backgroundColor: appConfig.themeColor }}
            type="submit"
          >
            Entrar
          </button>

          {hasError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              Credenciais invalidas ou variaveis admin nao configuradas.
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
