import { NextResponse } from "next/server";
import { getFallbackAppSettings, settingsRowToAppSettings, extractHostname } from "@/lib/app-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { appConfig } from "@/lib/app-config";
import { logServerInfo, logServerWarn, logServerError } from "@/lib/logger/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createSupabaseAdminClient();
  const hostname = extractHostname(appConfig.publicUrl);
  const startMs = Date.now();

  if (!supabase) {
    logServerWarn("api_settings_fallback", { tenantDomain: hostname, reason: "supabase_not_configured", source: "env" });
    return NextResponse.json({
      ok: true,
      source: "env",
      settings: getFallbackAppSettings(),
    });
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("tenant_domain", hostname)
    .maybeSingle();

  const durationMs = Date.now() - startMs;

  if (error) {
    logServerError("api_settings_error", error, { tenantDomain: hostname, source: "env", durationMs });
    return NextResponse.json({
      ok: true,
      source: "env",
      settings: getFallbackAppSettings(),
    });
  }

  const source = data ? "database" : "env";
  const settings = settingsRowToAppSettings(data);

  logServerInfo("api_settings_response", {
    tenantDomain: hostname,
    source,
    appName: settings.appName,
    publicUrl: settings.publicUrl,
    hasOneSignalAppId: Boolean(settings.oneSignalAppId),
    durationMs,
  });

  return NextResponse.json({
    ok: true,
    source,
    settings,
  });
}
