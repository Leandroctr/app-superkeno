import "server-only";

import { cache } from "react";
import { getFallbackAppSettings, settingsRowToAppSettings } from "@/lib/app-settings";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export const getAppSettings = cache(async function getAppSettings() {
  const supabase = createSupabaseAdminClient();

  if (!supabase) {
    return getFallbackAppSettings();
  }

  const { data, error } = await supabase
    .from("app_settings")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return getFallbackAppSettings();
  }

  return settingsRowToAppSettings(data);
});
