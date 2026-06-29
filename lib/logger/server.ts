import "server-only";

import type { LogMetadata } from "./types";

const PREFIX = "[server-log]";

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
    const errorInfo =
      error instanceof Error
        ? { errorName: error.name, errorMessage: error.message }
        : error !== undefined
          ? { error: String(error) }
          : {};
    console.error(PREFIX, event, { ...errorInfo, ...(metadata ?? {}) });
  } catch {
    // never throw
  }
}
