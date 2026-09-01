import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { appConfig } from "@/lib/app-config";
import { extractHostname } from "@/lib/app-settings";
import { createAdminSession, validateAdminCredentials } from "@/lib/admin-auth";
import { createSupabaseSessionClient } from "@/lib/supabase/admin-session";
import { logServerInfo, logServerWarn } from "@/lib/logger/server";
import { consumeRateLimits, resetRateLimit } from "@/lib/rate-limit.server";
import {
  extractClientIp,
  normalizeAccountIdentifier,
} from "@/lib/request-security";

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
  const tenantDomain = extractHostname(appConfig.publicUrl);
  const clientIp = extractClientIp(await headers());
  const account = normalizeAccountIdentifier(email);
  const ipIdentifier = `${tenantDomain}\0${clientIp}`;
  const accountIdentifier = `${tenantDomain}\0${account}`;
  const rateLimit = await consumeRateLimits([
    {
      scope: "admin_login_ip",
      identifier: ipIdentifier,
      limit: 30,
      windowSeconds: 15 * 60,
    },
    {
      scope: "admin_login_account",
      identifier: accountIdentifier,
      limit: 10,
      windowSeconds: 15 * 60,
    },
  ]);

  if (rateLimit.unavailable) {
    logServerWarn("admin_login_rate_limit_unavailable", { tenantDomain });
    redirect("/admin/login?error=security_unavailable");
  }

  if (!rateLimit.allowed) {
    logServerWarn("admin_login_rate_limited", {
      tenantDomain,
      scope: rateLimit.limitedScope,
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    });
    redirect("/admin/login?error=rate_limited");
  }

  const supabaseOk = await tryLoginWithSupabaseAuth(email, password);

  if (supabaseOk) {
    // Sessao Supabase Auth criada (cookies sb-*). /admin e /admin/settings ja
    // usam requireTenantAccess(), entao essa sessao real basta para entrar —
    // nao precisa (nem deve) passar pelo cookie legado. Quem nao tiver linha
    // em admin_users (ou nao tiver acesso a este tenant_domain) e barrado
    // pelo proprio guard de /admin, nao aqui.
    await resetRateLimit("admin_login_account", accountIdentifier);
    logServerInfo("admin_login_supabase_auth_ok", { tenantDomain });
    redirect("/admin");
  }

  if (!validateAdminCredentials(email, password)) {
    redirect("/admin/login?error=1");
  }

  await resetRateLimit("admin_login_account", accountIdentifier);
  logServerWarn("admin_login_legacy_fallback_used", { tenantDomain });
  await createAdminSession();
  redirect("/admin");
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const hasError = params.error === "1";
  const isRateLimited = params.error === "rate_limited";
  const isSecurityUnavailable = params.error === "security_unavailable";

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
              Email ou senha invalidos.
            </p>
          ) : null}

          {isRateLimited ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Muitas tentativas. Aguarde alguns minutos e tente novamente.
            </p>
          ) : null}

          {isSecurityUnavailable ? (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
              Login temporariamente indisponivel. Tente novamente em instantes.
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
