import { redirect } from "next/navigation";
import {
  getAdminPendingMfaForTenant,
  isAdminMfaAssuranceSatisfied,
} from "@/lib/admin-identity.server";
import { appConfig } from "@/lib/app-config";
import { createSupabaseSessionClient } from "@/lib/supabase/admin-session";
import { MfaForm } from "./mfa-form";

export const dynamic = "force-dynamic";

export default async function AdminMfaPage() {
  const admin = await getAdminPendingMfaForTenant();
  const sessionClient = await createSupabaseSessionClient();

  if (!admin || !sessionClient) {
    if (sessionClient) {
      await sessionClient.auth.signOut({ scope: "global" });
    }
    redirect("/admin/login?error=1");
  }

  const [assuranceResult, factorsResult] = await Promise.all([
    sessionClient.auth.mfa.getAuthenticatorAssuranceLevel(),
    sessionClient.auth.mfa.listFactors(),
  ]);

  if (
    !assuranceResult.error &&
    isAdminMfaAssuranceSatisfied(assuranceResult.data)
  ) {
    redirect("/admin");
  }

  const hasMfaStateError = Boolean(
    assuranceResult.error || factorsResult.error,
  );
  const verifiedFactors = (factorsResult.data?.totp || []).map((factor) => ({
    id: factor.id,
    friendlyName: factor.friendly_name || null,
  }));

  return (
    <main
      className="grid min-h-dvh place-items-center px-5 py-8 text-slate-950"
      style={{ backgroundColor: appConfig.backgroundColor }}
    >
      <section className="w-full max-w-md">
        <div className="mb-8">
          <p className="text-sm font-semibold text-slate-500">
            {appConfig.shortName}
          </p>
          <h1 className="mt-1 text-2xl font-black tracking-normal">
            Verificacao em duas etapas
          </h1>
        </div>

        <div className="grid gap-5 rounded-lg bg-white p-5 shadow-sm">
          {hasMfaStateError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              Nao foi possivel verificar o MFA. Saia e tente novamente.
            </p>
          ) : verifiedFactors.length > 0 ? (
            <MfaForm mode="challenge" verifiedFactors={verifiedFactors} />
          ) : (
            <MfaForm mode="enrollment" />
          )}

          <form action="/api/admin/logout" method="post">
            <button className="text-sm font-bold text-slate-600" type="submit">
              Sair
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
