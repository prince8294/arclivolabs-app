import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';

interface SessionPayload {
  sub: 'owner';
  exp: number;
  ver: number;
}

function encode(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function sign(value: string): string {
  return crypto.createHmac('sha256', config.sessionSigningKey).update(value).digest('base64url');
}

export function createSessionToken(version: number): string {
  if (config.sessionSigningKey.length < 32) {
    throw new Error('Session signing is not configured.');
  }
  const payload: SessionPayload = {
    sub: 'owner',
    exp: Math.floor(Date.now() / 1000) + config.sessionTtlSeconds,
    ver: version,
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function verifySessionToken(token: string, expectedVersion: number): boolean {
  try {
    const [encoded, signature] = token.split('.');
    if (!encoded || !signature || !config.sessionSigningKey) return false;
    const expected = sign(encoded);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      return false;
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    return payload.sub === 'owner' && payload.ver === expectedVersion && payload.exp > Date.now() / 1000;
  } catch {
    return false;
  }
}

export function verifyOwnerPassword(password: string): boolean {
  try {
    const [algorithm, salt, expected] = config.ownerPasswordHash.split('$');
    if (algorithm !== 'scrypt' || !salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export function requireHttpsInProduction(req: Request, res: Response, next: NextFunction): void {
  const forwarded = req.header('x-forwarded-proto');
  if (config.nodeEnv === 'production' && !req.secure && forwarded !== 'https') {
    res.status(400).json({ error: 'HTTPS is required.' });
    return;
  }
  next();
}

export function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
