import { NextResponse } from "next/server";
import { appSettingsToRow, extractHostname, settingsRowToAppSettings } from "@/lib/app-settings";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { appConfig } from "@/lib/app-config";
import { requireTenantAccess } from "@/lib/admin-identity.server";

type SettingsPayload = {
  id?: string;
  tenantDomain?: string;
  appName?: string;
  appShortName?: string;
  appDescription?: string;
  platformUrl?: string;
  supportUrl?: string;
  publicUrl?: string;
  logoUrl?: string;
  icon192Url?: string;
  icon512Url?: string;
  faviconUrl?: string;
  themeColor?: string;
  backgroundColor?: string;
  splashTitle?: string;
  splashMessage?: string;
  splashImageUrl?: string;
  splashHtmlUrl?: string;
  redirectDelayMs?: number;
  notificationsEnabled?: boolean;
  oneSignalAppId?: string;
};

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizePayload(payload: SettingsPayload) {
  return {
    id: cleanText(payload.id),
    tenantDomain: cleanText(payload.tenantDomain),
    appName: cleanText(payload.appName),
    appShortName: cleanText(payload.appShortName),
    appDescription: cleanText(payload.appDescription),
    platformUrl: cleanText(payload.platformUrl),
    supportUrl: cleanText(payload.supportUrl),
    publicUrl: cleanText(payload.publicUrl),
    logoUrl: cleanText(payload.logoUrl),
    icon192Url: cleanText(payload.icon192Url),
    icon512Url: cleanText(payload.icon512Url),
    faviconUrl: cleanText(payload.faviconUrl),
    themeColor: cleanText(payload.themeColor, "#101828"),
    backgroundColor: cleanText(payload.backgroundColor, "#f6f7fb"),
    splashTitle: cleanText(payload.splashTitle),
    splashMessage: cleanText(payload.splashMessage),
    splashImageUrl: cleanText(payload.splashImageUrl),
    splashHtmlUrl: cleanText(payload.splashHtmlUrl),
    redirectDelayMs: Math.max(
      0,
      Math.round(Number(payload.redirectDelayMs) || 1500),
    ),
    notificationsEnabled: Boolean(payload.notificationsEnabled),
    oneSignalAppId: cleanText(payload.oneSignalAppId),
  };
}

export async function POST(request: Request) {
  // Mesmo padrao de guard adotado em /admin e /admin/settings: sessao
  // Supabase real (checada por tenant) OU cookie legado, qualquer um dos
  // dois libera o acesso nesta fase de transicao.
  const currentAdmin = await requireTenantAccess();
  const hasLegacySession = await isAdminAuthenticated();

  if (!currentAdmin && !hasLegacySession) {
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

  const settings = normalizePayload(payload);
  const row = appSettingsToRow(settings);
  const query = settings.id
    ? supabase.from("app_settings").update(row).eq("tenant_domain", hostname)
    : supabase
        .from("app_settings")
        .upsert({ ...row, tenant_domain: hostname }, { onConflict: "tenant_domain" });

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
