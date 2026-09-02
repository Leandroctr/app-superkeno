import type { LogMetadata } from "./types";

const PREFIX = "[client-log]";

function getErrorName(error: unknown): string {
  const candidate =
    error instanceof Error
      ? error.name
      : error !== null && typeof error === "object"
        ? (error as Record<string, unknown>).name
        : undefined;

  return typeof candidate === "string" && /^[a-zA-Z0-9._:-]+$/.test(candidate)
    ? candidate.slice(0, 64)
    : "UnknownError";
}

export function logClientInfo(event: string, metadata?: LogMetadata): void {
  try {
    console.log(PREFIX, event, metadata ?? "");
  } catch {
    // never throw
  }
}

export function logClientWarn(event: string, metadata?: LogMetadata): void {
  try {
    console.warn(PREFIX, event, metadata ?? "");
  } catch {
    // never throw
  }
}

export function logClientError(
  event: string,
  error?: unknown,
  metadata?: LogMetadata,
): void {
  try {
    const errorInfo = error === undefined ? {} : { errorName: getErrorName(error) };
    console.error(PREFIX, event, { ...errorInfo, ...(metadata ?? {}) });
  } catch {
    // never throw
  }
}
