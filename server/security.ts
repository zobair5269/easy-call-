import crypto from 'node:crypto';
import path from 'node:path';
import type { Request } from 'express';
import { db, UPLOAD_DIR } from './db.ts';

function resolveServerSecret(): string {
  const envSecret = process.env.SESSION_SECRET?.trim();
  if (envSecret) return envSecret;
  try {
    const row = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'server_secret'`)
      .get() as { value: string } | undefined;
    if (row?.value) return row.value;
    const generated = crypto.randomBytes(32).toString('hex');
    db.prepare(
      `INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES ('server_secret', ?, ?)`
    ).run(generated, Date.now());
    const saved = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'server_secret'`)
      .get() as { value: string } | undefined;
    return saved?.value || generated;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const SERVER_SECRET = resolveServerSecret();

export function hashWithServerSecret(value: string): string {
  return crypto.createHmac('sha256', SERVER_SECRET).update(value).digest('hex');
}

export function hashOtp(phoneE164: string, code: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(`${phoneE164}:${code}`, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyOtpHash(phoneE164: string, code: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const actualBuf = crypto.scryptSync(`${phoneE164}:${code}`, salt, 32);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const actualBuf = crypto.scryptSync(pin, salt, 32);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateOtpCode(): string {
  return String(crypto.randomInt(100000, 1000000));
}

export function normalizePhoneE164(raw: string): string | null {
  let cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+8800') && cleaned.length >= 14) {
    cleaned = '+880' + cleaned.slice(5);
  }
  if (!/^\+[1-9]\d{5,14}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export function detectImageMimeFromMagicBytes(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mime: 'image/png', ext: 'png' };
  }
  // WebP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export function resolveSafeUploadPath(fileName: string): string | null {
  const safeBase = path.basename(fileName);
  const resolved = path.resolve(UPLOAD_DIR, safeBase);
  if (!resolved.startsWith(UPLOAD_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

const rateBuckets = new Map<string, RateBucket>();

export function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const existing = rateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxRequests) {
    return false;
  }
  existing.count += 1;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateBuckets.entries()) {
    if (v.resetAt <= now) rateBuckets.delete(k);
  }
}, 60_000).unref();

export function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

export function verifySameOriginIfCookie(req: Request, usedCookieAuth: boolean): boolean {
  if (!usedCookieAuth) return true;
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host) as string | undefined;
  if (!origin || !host) {
    return req.headers['x-requested-with'] === 'EasyCallClient';
  }
  if (origin === 'https://easycall.app' && req.headers['x-requested-with'] === 'EasyCallClient') {
    return true;
  }
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.host === host;
  } catch {
    return false;
  }
}
