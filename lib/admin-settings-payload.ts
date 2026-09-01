import type { AppSettings } from "@/lib/app-settings";

export type SettingsPayload = Omit<Partial<AppSettings>, "tenantDomain"> & {
  tenantDomain?: unknown;
};

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

export function normalizeSettingsPayload(payload: SettingsPayload) {
  return {
    id: cleanText(payload.id),
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

export function resolveTenantSettings(
  payload: SettingsPayload,
  serverTenantDomain: string,
): AppSettings {
  return {
    ...normalizeSettingsPayload(payload),
    tenantDomain: serverTenantDomain,
  };
}
