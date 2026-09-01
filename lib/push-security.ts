const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

export const MAX_PUSH_ERROR_MESSAGE_LENGTH = 500;

type OneSignalErrorDetails = {
  provider: "onesignal";
  status: number;
  code?: string;
  message: string;
  requestId?: string;
};

function parseHttpUrl(value: string, baseUrl?: string): URL | null {
  try {
    const parsed = baseUrl ? new URL(value, baseUrl) : new URL(value);
    return HTTP_PROTOCOLS.has(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

export function isSafePushTargetUrl(value: unknown, baseUrl?: string): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value !== value.trim() ||
    /\s/.test(value)
  ) {
    return false;
  }

  if (value.startsWith("/")) {
    if (value.startsWith("//")) {
      return false;
    }

    const base = parseHttpUrl(baseUrl || "https://internal.invalid");
    if (!base) {
      return false;
    }

    const resolved = parseHttpUrl(value, base.href);
    return Boolean(resolved && resolved.origin === base.origin);
  }

  return /^https?:\/\//i.test(value) && Boolean(parseHttpUrl(value));
}

export function resolvePushTargetUrl(
  requestedValue: unknown,
  fallbackCandidates: unknown[],
  baseUrl?: string,
): string {
  if (isSafePushTargetUrl(requestedValue, baseUrl)) {
    return requestedValue;
  }

  for (const candidate of fallbackCandidates) {
    if (isSafePushTargetUrl(candidate, baseUrl)) {
      return candidate;
    }
  }

  return "/";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sanitizeIdentifier(value: unknown, maxLength: number): string | undefined {
  const normalized =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";

  if (!normalized || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    return undefined;
  }

  return normalized.slice(0, maxLength);
}

function sanitizeMessage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 160) : undefined;
}

function readKnownMessage(result: Record<string, unknown>): string | undefined {
  const direct = sanitizeMessage(result.message) || sanitizeMessage(result.error);
  if (direct) {
    return direct;
  }

  if (!Array.isArray(result.errors) || result.errors.length === 0) {
    return undefined;
  }

  const firstError = result.errors[0];
  if (typeof firstError === "string") {
    return sanitizeMessage(firstError);
  }

  const firstErrorRecord = asRecord(firstError);
  return firstErrorRecord ? sanitizeMessage(firstErrorRecord.message) : undefined;
}

export function formatOneSignalError(status: number, result: unknown): string {
  const record = asRecord(result);
  const nestedError = record ? asRecord(record.error) : null;
  const details: OneSignalErrorDetails = {
    provider: "onesignal",
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0,
    message: record
      ? readKnownMessage(record) ||
        (nestedError ? readKnownMessage(nestedError) : undefined) ||
        "OneSignal request failed."
      : "OneSignal request failed.",
  };

  const code = sanitizeIdentifier(record?.code ?? nestedError?.code, 64);
  const requestId = sanitizeIdentifier(record?.request_id ?? record?.requestId, 96);

  if (code) {
    details.code = code;
  }
  if (requestId) {
    details.requestId = requestId;
  }

  const serialized = JSON.stringify(details);
  if (serialized.length <= MAX_PUSH_ERROR_MESSAGE_LENGTH) {
    return serialized;
  }

  return JSON.stringify({
    provider: "onesignal",
    status: details.status,
    message: "OneSignal request failed.",
  });
}
