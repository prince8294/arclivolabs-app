import 'dotenv/config';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: positiveInteger(process.env.PORT, 5000),
  sessionSigningKey: process.env.SESSION_SIGNING_KEY || '',
  ownerPasswordHash: process.env.OWNER_PASSWORD_HASH || '',
  dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY || '',
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean),
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri:
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
  dataDir: process.env.ARCLIVO_DATA_DIR || '',
  requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '2mb',
  sessionTtlSeconds: positiveInteger(process.env.SESSION_TTL_SECONDS, 60 * 60 * 12),
  schedulerPollMs: positiveInteger(process.env.SCHEDULER_POLL_MS, 15_000),
  gmailTimeoutMs: positiveInteger(process.env.GMAIL_TIMEOUT_MS, 20_000),
};

export function assertSafeStartup(): void {
  if (config.nodeEnv !== 'production') return;

  const missing: string[] = [];
  if (config.sessionSigningKey.length < 32) missing.push('SESSION_SIGNING_KEY (minimum 32 characters)');
  if (!config.ownerPasswordHash) missing.push('OWNER_PASSWORD_HASH');
  if (!config.dataEncryptionKey) missing.push('DATA_ENCRYPTION_KEY');

  if (missing.length > 0) {
    throw new Error(`Unsafe production configuration. Missing: ${missing.join(', ')}`);
  }
}
