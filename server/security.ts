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

export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;

export interface SignedSessionPayload {
  uid: string;
  ph: string;
  ci: string;
  cc: string;
  dn: string;
  lg: string;
  qt: string;
  iat: number;
  exp: number;
  jti: string;
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function createSignedSessionToken(
  user: {
    id: string;
    phone_e164: string;
    country_iso: string;
    country_code: string;
    display_name: string;
    language: string;
    qr_token: string;
  },
  ttlMs = SESSION_TTL_MS
): string {
  const now = Date.now();
  const payload: SignedSessionPayload = {
    uid: user.id,
    ph: user.phone_e164,
    ci: (user.country_iso || 'US').slice(0, 4),
    cc: (user.country_code || '+1').slice(0, 8),
    dn: (user.display_name || '').slice(0, 60),
    lg: (user.language || 'en').slice(0, 8),
    qt: user.qr_token,
    iat: now,
    exp: now + ttlMs,
    jti: crypto.randomBytes(16).toString('base64url'),
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = `ec1.${payloadB64}`;
  const sigB64 = crypto
    .createHmac('sha256', SERVER_SECRET)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sigB64}`;
}

export function verifySignedSessionToken(rawToken: string): SignedSessionPayload | null {
  if (!rawToken || !rawToken.startsWith('ec1.')) return null;
  const parts = rawToken.split('.');
  if (parts.length !== 3) return null;
  const [, payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  try {
    const signingInput = `ec1.${payloadB64}`;
    const expectedSig = crypto.createHmac('sha256', SERVER_SECRET).update(signingInput).digest();
    const actualSig = Buffer.from(sigB64, 'base64url');
    if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
      return null;
    }

    const parsed = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Partial<SignedSessionPayload>;
    if (
      typeof parsed.uid !== 'string' ||
      !parsed.uid ||
      typeof parsed.ph !== 'string' ||
      typeof parsed.qt !== 'string' ||
      !parsed.qt ||
      typeof parsed.jti !== 'string' ||
      !parsed.jti ||
      typeof parsed.exp !== 'number' ||
      parsed.exp <= Date.now()
    ) {
      return null;
    }
    const normalizedPhone = normalizePhoneE164(parsed.ph);
    if (!normalizedPhone) return null;

    return {
      uid: parsed.uid,
      ph: normalizedPhone,
      ci: typeof parsed.ci === 'string' ? parsed.ci.slice(0, 4) : 'US',
      cc: typeof parsed.cc === 'string' ? parsed.cc.slice(0, 8) : '+1',
      dn: typeof parsed.dn === 'string' ? parsed.dn.slice(0, 60) : '',
      lg: typeof parsed.lg === 'string' ? parsed.lg.slice(0, 8) : 'en',
      qt: parsed.qt,
      iat: typeof parsed.iat === 'number' ? parsed.iat : Date.now(),
      exp: parsed.exp,
      jti: parsed.jti,
    };
  } catch {
    return null;
  }
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

export function normalizeContactCandidates(raw: string, defaultCountryCode = '+1'): string[] {
  const candidates = new Set<string>();
  const cleaned = raw.trim().replace(/[\s\-().]/g, '');
  if (!cleaned) return [];

  if (cleaned.startsWith('+')) {
    const direct = normalizePhoneE164(cleaned);
    if (direct) candidates.add(direct);
  } else if (cleaned.startsWith('00')) {
    const intl = normalizePhoneE164('+' + cleaned.slice(2));
    if (intl) candidates.add(intl);
  } else if (/^\d{5,15}$/.test(cleaned)) {
    const cc = defaultCountryCode.startsWith('+') ? defaultCountryCode : `+${defaultCountryCode}`;
    const ccDigits = cc.slice(1);
    const noLeadingZero = cleaned.replace(/^0+/, '');
    if (cleaned.startsWith('0')) {
      const localWithCc = normalizePhoneE164(`${cc}${noLeadingZero}`);
      if (localWithCc) candidates.add(localWithCc);
    } else {
      const localWithCc = normalizePhoneE164(`${cc}${cleaned}`);
      if (localWithCc) candidates.add(localWithCc);
      if (cleaned.startsWith(ccDigits) && cleaned.length > ccDigits.length + 4) {
        const directIntl = normalizePhoneE164(`+${cleaned}`);
        if (directIntl) candidates.add(directIntl);
      } else {
        const plusDirect = normalizePhoneE164(`+${cleaned}`);
        if (plusDirect) candidates.add(plusDirect);
      }
    }
  }
  return Array.from(candidates);
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
