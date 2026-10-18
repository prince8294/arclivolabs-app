"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rateLimit = rateLimit;
exports.requireOwner = requireOwner;
const store_1 = require("../models/store");
const security_1 = require("../utils/security");
function rateLimit(options) {
    const buckets = new Map();
    return (req, res, next) => {
        const now = Date.now();
        const key = (0, security_1.clientIp)(req);
        let bucket = buckets.get(key);
        if (!bucket || bucket.resetAt <= now) {
            bucket = { count: 0, resetAt: now + options.windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;
        res.setHeader('RateLimit-Limit', String(options.max));
        res.setHeader('RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
        res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
        if (bucket.count > options.max) {
            res.status(429).json({ error: 'Too many requests. Please try again later.' });
            return;
        }
        if (buckets.size > 5000) {
            for (const [bucketKey, value] of buckets)
                if (value.resetAt <= now)
                    buckets.delete(bucketKey);
        }
        next();
    };
}
async function requireOwner(req, res, next) {
    const authorization = req.header('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const settings = await store_1.store.getSettings();
    if (!token || !(0, security_1.verifySessionToken)(token, settings.authSessionVersion)) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
    }
    next();
}
