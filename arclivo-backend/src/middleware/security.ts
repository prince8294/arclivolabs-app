import { NextFunction, Request, Response } from 'express';
import { store } from '../models/store';
import { clientIp, verifySessionToken } from '../utils/security';

interface RateBucket {
  count: number;
  resetAt: number;
}

export function rateLimit(options: { windowMs: number; max: number }) {
  const buckets = new Map<string, RateBucket>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = clientIp(req);
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
      for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
    }
    next();
  };
}

export async function requireOwner(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authorization = req.header('authorization') || '';
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const settings = await store.getSettings();
  if (!token || !verifySessionToken(token, settings.authSessionVersion)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
}
