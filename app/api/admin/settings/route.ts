import { NextResponse } from "next/server";
import { appSettingsToRow, extractHostname, settingsRowToAppSettings } from "@/lib/app-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { appConfig } from "@/lib/app-config";
import { requireTenantAccess } from "@/lib/admin-identity.server";
import {
  resolveLegacySplashHtmlUrl,
  resolveTenantSettings,
  type SettingsPayload,
} from "@/lib/admin-settings-payload";

export async function POST(request: Request) {
  const currentAdmin = await requireTenantAccess();
  if (!currentAdmin) {
    return NextResponse.json(
      { ok: false, error: "Nao autenticado." },
      { status: 401 },
    );
  }

  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Supabase nao configurado." },
      { status: 503 },
    );
  }

  let payload: SettingsPayload;

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload invalido." },
      { status: 400 },
    );
  }

  const hostname = extractHostname(appConfig.publicUrl);

  // Bloqueio de seguranca: "localhost" nao e um tenant real. Sem isso,
  // qualquer teste local de salvamento grava uma linha em app_settings no
  // mesmo Supabase compartilhado de producao (ja aconteceu uma vez, ver
  // docs/ADMIN_AUTH_PLAN.md do app-big). Testes locais de leitura
  // continuam funcionando normalmente (GET /api/settings nao e afetado).
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Gravacao de settings bloqueada para tenant_domain 'localhost'. " +
          "Configure NEXT_PUBLIC_PUBLIC_URL com um dominio real (ou de staging) para testar o salvamento.",
      },
      { status: 403 },
    );
  }

  const { data: currentRow, error: currentRowError } = await supabase
    .from("app_settings")
    .select("splash_html_url")
    .eq("tenant_domain", hostname)
    .maybeSingle();

  if (currentRowError) {
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel validar a splash HTML atual." },
      { status: 500 },
    );
  }

  const splashHtmlUrl = resolveLegacySplashHtmlUrl(
    payload,
    currentRow?.splash_html_url,
  );

  if (splashHtmlUrl === null) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Novas URLs de splash HTML estao desativadas. Mantenha a URL legada atual ou remova-a.",
      },
      { status: 400 },
    );
  }

  // tenantDomain from the request body is deliberately ignored. Both write
  // paths use only the tenant resolved from the server-side deployment URL.
  const settings = resolveTenantSettings(
    { ...payload, splashHtmlUrl },
    hostname,
  );
  const row = appSettingsToRow(settings);
  const query = settings.id
    ? supabase.from("app_settings").update(row).eq("tenant_domain", hostname)
    : supabase
        .from("app_settings")
        .upsert(row, { onConflict: "tenant_domain" });

  const { data, error } = await query.select("*").single();

  if (error || !data) {
    return NextResponse.json(
      { ok: false, error: "Nao foi possivel salvar as configuracoes." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    settings: settingsRowToAppSettings(data),
  });
}
