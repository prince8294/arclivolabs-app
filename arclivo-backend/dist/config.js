"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.assertSafeStartup = assertSafeStartup;
require("dotenv/config");
function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
exports.config = {
    nodeEnv: process.env.NODE_ENV || 'development',
    isVercel: process.env.VERCEL === '1',
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
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
    dataDir: process.env.ARCLIVO_DATA_DIR || '',
    persistenceDriver: process.env.PERSISTENCE_DRIVER ||
        (process.env.NODE_ENV === 'production' || process.env.VERCEL === '1' ? 'mongodb' : 'json'),
    mongodbUri: process.env.MONGODB_URI || '',
    mongodbDbName: process.env.MONGODB_DB_NAME || 'arclivo',
    mongodbStateCollection: process.env.MONGODB_STATE_COLLECTION || 'app_state',
    cronSecret: process.env.CRON_SECRET || '',
    requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '2mb',
    sessionTtlSeconds: positiveInteger(process.env.SESSION_TTL_SECONDS, 60 * 60 * 12),
    schedulerPollMs: positiveInteger(process.env.SCHEDULER_POLL_MS, 15_000),
    gmailTimeoutMs: positiveInteger(process.env.GMAIL_TIMEOUT_MS, 20_000),
};
function assertSafeStartup() {
    if (exports.config.nodeEnv !== 'production' && !exports.config.isVercel)
        return;
    const missing = [];
    if (exports.config.sessionSigningKey.length < 32)
        missing.push('SESSION_SIGNING_KEY (minimum 32 characters)');
    if (!exports.config.ownerPasswordHash)
        missing.push('OWNER_PASSWORD_HASH');
    if (!exports.config.dataEncryptionKey)
        missing.push('DATA_ENCRYPTION_KEY');
    if (exports.config.persistenceDriver !== 'mongodb')
        missing.push('PERSISTENCE_DRIVER=mongodb');
    if (!exports.config.mongodbUri)
        missing.push('MONGODB_URI');
    if (exports.config.cronSecret.length < 32)
        missing.push('CRON_SECRET (minimum 32 characters)');
    if (missing.length > 0) {
        throw new Error(`Unsafe production configuration. Missing: ${missing.join(', ')}`);
    }
}
assertSafeStartup();
