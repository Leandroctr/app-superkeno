import "server-only";

import type { LogMetadata } from "./types";

const PREFIX = "[server-log]";

function sanitizeErrorIdentifier(value: unknown): string | undefined {
  const normalized =
    typeof value === "string" || typeof value === "number" ? String(value) : "";

  if (!normalized || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    return undefined;
  }

  return normalized.slice(0, 64);
}

function getErrorInfo(error: unknown): LogMetadata {
  if (error === undefined) {
    return {};
  }

  const record =
    error !== null && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  const errorName = sanitizeErrorIdentifier(
    error instanceof Error ? error.name : record?.name,
  ) || "UnknownError";
  const errorCode = sanitizeErrorIdentifier(
    record?.code ?? record?.statusCode ?? record?.status,
  );

  return errorCode ? { errorName, errorCode } : { errorName };
}

export function logServerInfo(event: string, metadata?: LogMetadata): void {
  try {
    console.log(PREFIX, event, metadata ?? "");
  } catch {
    // never throw
  }
}

export function logServerWarn(event: string, metadata?: LogMetadata): void {
  try {
    console.warn(PREFIX, event, metadata ?? "");
  } catch {
    // never throw
  }
}

export function logServerError(
  event: string,
  error?: unknown,
  metadata?: LogMetadata,
): void {
  try {
    const errorInfo = getErrorInfo(error);
    console.error(PREFIX, event, { ...errorInfo, ...(metadata ?? {}) });
  } catch {
    // never throw
  }
}
