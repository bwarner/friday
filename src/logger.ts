/**
 * Minimal structured logger with secret redaction.
 * Per the safety rules: tokens and keys never reach the logs.
 */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /ghs_[A-Za-z0-9]{20,}/g,
];

function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return SECRET_PATTERNS.reduce((s, re) => s.replace(re, "[redacted]"), value);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v)]),
    );
  }
  return value;
}

function emit(level: string, msg: string, meta?: Record<string, unknown>) {
  const line = { ts: new Date().toISOString(), level, msg, ...(meta ?? {}) };
  console.log(JSON.stringify(redact(line)));
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};
