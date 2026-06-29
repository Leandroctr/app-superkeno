import "server-only";

import { cache } from "react";
import { extractHostname, getFallbackAppSettings, settingsRowToAppSettings } from "@/lib/app-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { appConfig } from "@/lib/app-config";
import { logServerInfo, logServerWarn, logServerError } from "@/lib/logger/server";

export const getAppSettings = cache(async function getAppSettings() {
  const supabase = createSupabaseAdminClient();
  const hostname = extractHostname(appConfig.publicUrl);
  const startMs = Date.now();

  if (!supabase) {
    logServerWarn("settings_fetch_skip", { tenantDomain: hostname, reason: "supabase_not_configured", source: "env" });
    return getFallbackAppSettings();
  }

  logServerInfo("settings_fetch_start", { tenantDomain: hostname });

  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .eq("tenant_domain", hostname)
    .maybeSingle();

  const durationMs = Date.now() - startMs;

  if (error) {
    logServerError("settings_fetch_error", error, { tenantDomain: hostname, source: "env", durationMs });
    return getFallbackAppSettings();
  }

  if (!data) {
    logServerWarn("settings_fetch_not_found", { tenantDomain: hostname, source: "env", durationMs });
  } else {
    logServerInfo("settings_fetch_success", {
      tenantDomain: hostname,
      source: "database",
      appName: data.app_name,
      publicUrl: data.public_url,
      hasOneSignalAppId: Boolean(data.onesignal_app_id),
      durationMs,
    });
  }

  return settingsRowToAppSettings(data);
});
