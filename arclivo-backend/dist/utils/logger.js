"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[-_]?key|code|verifier/i;
const BEARER = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
function redact(value, key = '') {
    if (SENSITIVE_KEY.test(key))
        return '[REDACTED]';
    if (typeof value === 'string')
        return value.replace(BEARER, 'Bearer [REDACTED]');
    if (Array.isArray(value))
        return value.map(item => redact(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            redact(entryValue, entryKey),
        ]));
    }
    return value;
}
function write(level, event, details) {
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        event,
        ...(details === undefined ? {} : { details: redact(details) }),
    };
    const line = JSON.stringify(payload);
    if (level === 'error')
        console.error(line);
    else if (level === 'warn')
        console.warn(line);
    else
        console.log(line);
}
exports.logger = {
    info: (event, details) => write('info', event, details),
    warn: (event, details) => write('warn', event, details),
    error: (event, details) => write('error', event, details),
};
