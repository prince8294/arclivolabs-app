const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[-_]?key|code|verifier/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

function redact(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return value.replace(BEARER, 'Bearer [REDACTED]');
  if (Array.isArray(value)) return value.map(item => redact(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey),
      ])
    );
  }
  return value;
}

function write(level: 'info' | 'warn' | 'error', event: string, details?: unknown): void {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(details === undefined ? {} : { details: redact(details) }),
  };
  const line = JSON.stringify(payload);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, details?: unknown) => write('info', event, details),
  warn: (event: string, details?: unknown) => write('warn', event, details),
  error: (event: string, details?: unknown) => write('error', event, details),
};
