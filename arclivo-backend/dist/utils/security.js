"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSessionToken = createSessionToken;
exports.verifySessionToken = verifySessionToken;
exports.verifyOwnerPassword = verifyOwnerPassword;
exports.requireHttpsInProduction = requireHttpsInProduction;
exports.clientIp = clientIp;
exports.randomId = randomId;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
function encode(value) {
    return Buffer.from(value).toString('base64url');
}
function sign(value) {
    return crypto_1.default.createHmac('sha256', config_1.config.sessionSigningKey).update(value).digest('base64url');
}
function createSessionToken(version) {
    if (config_1.config.sessionSigningKey.length < 32) {
        throw new Error('Session signing is not configured.');
    }
    const payload = {
        sub: 'owner',
        exp: Math.floor(Date.now() / 1000) + config_1.config.sessionTtlSeconds,
        ver: version,
    };
    const encoded = encode(JSON.stringify(payload));
    return `${encoded}.${sign(encoded)}`;
}
function verifySessionToken(token, expectedVersion) {
    try {
        const [encoded, signature] = token.split('.');
        if (!encoded || !signature || !config_1.config.sessionSigningKey)
            return false;
        const expected = sign(encoded);
        const signatureBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        if (signatureBuffer.length !== expectedBuffer.length ||
            !crypto_1.default.timingSafeEqual(signatureBuffer, expectedBuffer)) {
            return false;
        }
        const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
        return payload.sub === 'owner' && payload.ver === expectedVersion && payload.exp > Date.now() / 1000;
    }
    catch {
        return false;
    }
}
function verifyOwnerPassword(password) {
    try {
        const [algorithm, salt, expected] = config_1.config.ownerPasswordHash.split('$');
        if (algorithm !== 'scrypt' || !salt || !expected)
            return false;
        const actual = crypto_1.default.scryptSync(password, salt, 64).toString('hex');
        return crypto_1.default.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
    }
    catch {
        return false;
    }
}
function requireHttpsInProduction(req, res, next) {
    const forwarded = req.header('x-forwarded-proto');
    if (config_1.config.nodeEnv === 'production' && !req.secure && forwarded !== 'https') {
        res.status(400).json({ error: 'HTTPS is required.' });
        return;
    }
    next();
}
function clientIp(req) {
    return req.ip || req.socket.remoteAddress || 'unknown';
}
function randomId(prefix) {
    return `${prefix}_${crypto_1.default.randomUUID()}`;
}
