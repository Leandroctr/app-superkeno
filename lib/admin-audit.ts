import type { AppSettings } from "@/lib/app-settings";

export type AdminAuditOutcome = "attempt" | "success" | "failure" | "partial";

export type AdminAuditAction =
  | "settings.updated"
  | "asset.uploaded"
  | "push.sent"
  | "push.failed"
  | "push.partial";

type AuditScalar = string | number | boolean | null;
type AuditValue = AuditScalar | readonly string[];

declare const safeAuditJsonBrand: unique symbol;

export type SafeAuditJson = Readonly<Record<string, AuditValue>> & {
  readonly [safeAuditJsonBrand]: true;
};

const MAX_AUDIT_JSON_BYTES = 16 * 1024;
const FORBIDDEN_AUDIT_KEYS =
  /password|passphrase|access_token|refresh_token|(^|_)token($|_)|cookie|authorization|totp|secret|qr_payload|service_role|anon_key|publishable_key|onesignal_rest|binary|base64|raw_payload|recipients/i;

const SETTINGS_FIELDS = [
  "appName",
  "appShortName",
  "appDescription",
  "platformUrl",
  "supportUrl",
  "publicUrl",
  "logoUrl",
  "icon192Url",
  "icon512Url",
  "faviconUrl",
  "themeColor",
  "backgroundColor",
  "splashTitle",
  "splashMessage",
  "splashImageUrl",
  "splashHtmlUrl",
  "redirectDelayMs",
  "notificationsEnabled",
] as const;

const SETTINGS_CHANGE_FIELDS = [
  ...SETTINGS_FIELDS,
  "oneSignalAppId",
] as const;

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  return value.trim().slice(0, maxLength);
}

function urlWithoutSensitiveParts(
  value: unknown,
  maxLength = 2048,
): string | undefined {
  const normalized = text(value, maxLength);

  if (normalized === undefined) {
    return undefined;
  }

  try {
    const parsed = new URL(normalized);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().slice(0, maxLength);
  } catch {
    return normalized.split(/[?#]/, 1)[0].slice(0, maxLength);
  }
}

function safeJson(values: Record<string, AuditValue>): SafeAuditJson {
  for (const key of Object.keys(values)) {
    if (FORBIDDEN_AUDIT_KEYS.test(key)) {
      throw new Error("Forbidden audit field");
    }
  }

  const serialized = JSON.stringify(values);
  if (new TextEncoder().encode(serialized).byteLength > MAX_AUDIT_JSON_BYTES) {
    throw new Error("Audit JSON exceeds size limit");
  }

  return Object.freeze(values) as SafeAuditJson;
}

export function emptyAuditJson(): SafeAuditJson {
  return safeJson({});
}

export function sanitizeSettingsAuditSnapshot(
  settings: Partial<AppSettings> & Record<string, unknown>,
): SafeAuditJson {
  const result: Record<string, AuditValue> = {};
  const urlFields = new Set([
    "platformUrl",
    "supportUrl",
    "publicUrl",
    "logoUrl",
    "icon192Url",
    "icon512Url",
    "faviconUrl",
    "splashImageUrl",
    "splashHtmlUrl",
  ]);

  for (const field of SETTINGS_FIELDS) {
    const value = settings[field];

    if (urlFields.has(field)) {
      const sanitized = urlWithoutSensitiveParts(value);
      if (sanitized !== undefined) {
        result[field] = sanitized;
      }
    } else if (typeof value === "string") {
      result[field] = value.trim().slice(0, 2048);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      result[field] = value;
    } else if (typeof value === "boolean") {
      result[field] = value;
    }
  }

  return safeJson(result);
}

export function getSettingsAuditChangedFields(
  before: Partial<AppSettings> & Record<string, unknown>,
  after: Partial<AppSettings> & Record<string, unknown>,
): readonly string[] {
  return SETTINGS_CHANGE_FIELDS.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

export function sanitizeSettingsAuditMetadata(
  changedFields: readonly string[],
): SafeAuditJson {
  const allowed = new Set<string>(SETTINGS_CHANGE_FIELDS);
  return safeJson({
    changedFields: changedFields.filter((field) => allowed.has(field)),
  });
}

export function sanitizeAssetAuditMetadata(input: {
  assetType: unknown;
  mimeType: unknown;
  sizeBytes: unknown;
}): SafeAuditJson {
  const assetType = text(input.assetType, 80);
  const mimeType = text(input.mimeType, 120);
  const sizeBytes =
    typeof input.sizeBytes === "number" && Number.isFinite(input.sizeBytes)
      ? Math.max(0, Math.trunc(input.sizeBytes))
      : 0;

  return safeJson({
    ...(assetType === undefined ? {} : { assetType }),
    ...(mimeType === undefined ? {} : { mimeType }),
    sizeBytes,
  });
}

export function sanitizePushAuditMetadata(input: {
  targetType: unknown;
  recipientCount: unknown;
  httpStatus?: unknown;
  notificationAccepted?: unknown;
  campaignPersisted?: unknown;
}): SafeAuditJson {
  const result: Record<string, AuditValue> = {};
  const targetType = text(input.targetType, 40);

  if (targetType !== undefined) {
    result.targetType = targetType;
  }
  if (
    typeof input.recipientCount === "number" &&
    Number.isFinite(input.recipientCount)
  ) {
    result.recipientCount = Math.max(0, Math.trunc(input.recipientCount));
  }
  if (typeof input.httpStatus === "number" && Number.isFinite(input.httpStatus)) {
    result.httpStatus = Math.trunc(input.httpStatus);
  }
  if (typeof input.notificationAccepted === "boolean") {
    result.notificationAccepted = input.notificationAccepted;
  }
  if (typeof input.campaignPersisted === "boolean") {
    result.campaignPersisted = input.campaignPersisted;
  }

  return safeJson(result);
}

export function assertSafeAuditJson(value: SafeAuditJson): void {
  safeJson(value);
}
