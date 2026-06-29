export type LogLevel = "info" | "warn" | "error";

export type LogMetadata = Record<string, unknown>;

export type LogEntry = {
  level: LogLevel;
  event: string;
  message?: string;
  metadata?: LogMetadata;
};
