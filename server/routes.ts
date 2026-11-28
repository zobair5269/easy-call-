import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import {
  UPLOAD_DIR,
  areFriends,
  db,
  getFullSelfView,
  getPublicUserView,
  isBlockedBetween,
  normalizePair,
  type UserRow,
} from './db.ts';
import {
  SESSION_TTL_MS,
  checkRateLimit,
  detectImageMimeFromMagicBytes,
  detectVideoMimeFromMagicBytes,
  generateOtpCode,
  getClientIp,
  hashOtp,
  hashPin,
  normalizeContactCandidates,
  normalizePhoneE164,
  resolveSafeUploadPath,
  verifyOtpHash,
  verifyPin,
  verifySameOriginIfCookie,
} from './security.ts';
import {
  createPersistentSession,
  resolveOrRestoreSessionUser,
  revokeAllSessionsForDeletedUser,
  revokeSessionToken,
} from './session.ts';
import {
  acceptIncomingCallById,
  isUserOnline,
  notifyCallerRinging,
  registerBackgroundStream,
  rejectIncomingCallById,
  sendToUser,
  unregisterBackgroundStream,
} from './ws.ts';

interface AuthedRequest extends Request {
  user?: UserRow;
  usedCookieAuth?: boolean;
  authToken?: string;
}

const COUNTRY_DIAL_MAP: Record<string, { iso: string; code: string; name: string }> = {
  BD: { iso: 'BD', code: '+880', name: 'Bangladesh' },
  OM: { iso: 'OM', code: '+968', name: 'Oman' },
  AE: { iso: 'AE', code: '+971', name: 'United Arab Emirates' },
  QA: { iso: 'QA', code: '+974', name: 'Qatar' },
  SA: { iso: 'SA', code: '+966', name: 'Saudi Arabia' },
  IN: { iso: 'IN', code: '+91', name: 'India' },
  PK: { iso: 'PK', code: '+92', name: 'Pakistan' },
  GB: { iso: 'GB', code: '+44', name: 'United Kingdom' },
  US: { iso: 'US', code: '+1', name: 'United States' },
  CA: { iso: 'CA', code: '+1', name: 'Canada' },
  DE: { iso: 'DE', code: '+49', name: 'Germany' },
  FR: { iso: 'FR', code: '+33', name: 'France' },
  JP: { iso: 'JP', code: '+81', name: 'Japan' },
  CN: { iso: 'CN', code: '+86', name: 'China' },
  ES: { iso: 'ES', code: '+34', name: 'Spain' },
  BR: { iso: 'BR', code: '+55', name: 'Brazil' },
  RU: { iso: 'RU', code: '+7', name: 'Russia' },
  ID: { iso: 'ID', code: '+62', name: 'Indonesia' },
  TR: { iso: 'TR', code: '+90', name: 'Turkey' },
  MY: { iso: 'MY', code: '+60', name: 'Malaysia' },
  SG: { iso: 'SG', code: '+65', name: 'Singapore' },
  AU: { iso: 'AU', code: '+61', name: 'Australia' },
};

function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  const parts = [
    `easycall_sid=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'HttpOnly',
    isHttps ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (isHttps) {
    parts.push('Secure');
    parts.push('Partitioned');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(req: Request, res: Response) {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  const parts = [
    'easycall_sid=',
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    isHttps ? 'SameSite=None' : 'SameSite=Lax',
  ];
  if (isHttps) {
    parts.push('Secure');
    parts.push('Partitioned');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  let token: string | null = null;
  let usedCookie = false;

  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.cookies && typeof req.cookies.easycall_sid === 'string' && req.cookies.easycall_sid) {
    token = req.cookies.easycall_sid;
    usedCookie = true;
  }

  if (!token) {
    res.setHeader('X-EasyCall-Session', 'invalid');
    res.status(401).json({ error: 'Authentication required', sessionInvalid: true });
    return;
  }

  if (
    usedCookie &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    !verifySameOriginIfCookie(req, true)
  ) {
    res.status(403).json({ error: 'Cross-origin mutation rejected' });
    return;
  }

  const now = Date.now();
  const resolved = resolveOrRestoreSessionUser(
    token,
    String(req.headers['user-agent'] || '').slice(0, 200)
  );

  if (!resolved) {
    res.setHeader('X-EasyCall-Session', 'invalid');
    res.status(401).json({ error: 'Session expired or invalid', sessionInvalid: true });
    return;
  }

  const user = resolved.user;
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, user.id);
  if (usedCookie || req.path === '/users/me') {
    setSessionCookie(req, res, token, SESSION_TTL_MS);
  }
  req.user = user;
  req.usedCookieAuth = usedCookie;
  req.authToken = token;
  next();
}

async function deliverSmsOtp(phoneE164: string, code: string): Promise<'twilio' | 'preview'> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const fromPhone = process.env.TWILIO_PHONE_NUMBER?.trim();

  if (sid && authToken && fromPhone) {
    const body = new URLSearchParams({
      To: phoneE164,
      From: fromPhone,
      Body: `Your EASY CALL verification code is ${code}. Valid for 10 minutes.`,
    });
    const creds = Buffer.from(`${sid}:${authToken}`).toString('base64');
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      }
    );
    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`SMS gateway error: ${resp.status} ${errText}`);
    }
    return 'twilio';
  }
  return 'preview';
}

export function createApiRouter(): Router {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'easy-call', ts: Date.now() });
  });

  router.get('/geo/detect', (req, res) => {
    const headerCountry = (
      req.headers['cf-ipcountry'] ||
      req.headers['x-appengine-country'] ||
      req.headers['x-country-code'] ||
      ''
    )
      .toString()
      .toUpperCase()
      .trim();

    if (headerCountry && COUNTRY_DIAL_MAP[headerCountry]) {
      res.json({
        source: 'network',
        ...COUNTRY_DIAL_MAP[headerCountry],
      });
      return;
    }

    const acceptLang = (req.headers['accept-language'] || '').toString();
    const regionMatch = acceptLang.match(/[a-z]{2,3}-([A-Z]{2})/);
    if (regionMatch && COUNTRY_DIAL_MAP[regionMatch[1]]) {
      res.json({
        source: 'locale',
        ...COUNTRY_DIAL_MAP[regionMatch[1]],
      });
      return;
    }

    res.json({
      source: 'fallback',
      iso: 'US',
      code: '+1',
      name: 'United States',
    });
  });

  router.get('/rtc-config', (_req, res) => {
    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
    ];
    if (process.env.TURN_URL) {
      iceServers.push({
        urls: process.env.TURN_URL,
        username: process.env.TURN_USERNAME || undefined,
        credential: process.env.TURN_CREDENTIAL || undefined,
      });
    }
    res.json({ iceServers });
  });

  router.post('/auth/request-otp', async (req, res) => {
    const ip = getClientIp(req);
    if (!checkRateLimit(`otp-ip:${ip}`, 15, 10 * 60_000)) {
      res.status(429).json({ error: 'Too many OTP requests. Please wait a few minutes.' });
      return;
    }

    const rawPhone = typeof req.body?.phoneE164 === 'string' ? req.body.phoneE164 : '';
    const phoneE164 = normalizePhoneE164(rawPhone);
    if (!phoneE164) {
      res.status(400).json({ error: 'Please enter a valid international E.164 phone number.' });
      return;
    }

    if (!checkRateLimit(`otp-phone:${phoneE164}`, 5, 10 * 60_000)) {
      res.status(429).json({ error: 'Too many codes sent to this number. Please try again shortly.' });
      return;
    }

    const code = generateOtpCode();
    const challengeId = crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + 10 * 60_000;

    db.prepare('DELETE FROM otp_challenges WHERE phone_e164 = ?').run(phoneE164);
    db.prepare(
      `INSERT INTO otp_challenges (id, phone_e164, code_hash, expires_at, attempts, created_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    ).run(challengeId, phoneE164, hashOtp(phoneE164, code), expiresAt, now);

    try {
      const mode = await deliverSmsOtp(phoneE164, code);
      res.json({
        ok: true,
        challengeId,
        phoneE164,
        smsDeliveryMode: mode,
        previewCode: mode === 'preview' ? code : undefined,
        expiresInSec: 600,
      });
    } catch (err) {
      console.error('OTP delivery failed:', err);
      res.status(502).json({ error: 'Unable to send SMS verification code.' });
    }
  });

  router.post('/auth/verify-otp', (req, res) => {
    const ip = getClientIp(req);
    if (!checkRateLimit(`verify-ip:${ip}`, 25, 10 * 60_000)) {
      res.status(429).json({ error: 'Too many verification attempts. Wait a moment.' });
      return;
    }

    const rawPhone = typeof req.body?.phoneE164 === 'string' ? req.body.phoneE164 : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const countryIso =
      typeof req.body?.countryIso === 'string' ? req.body.countryIso.slice(0, 4).toUpperCase() : 'US';
    const countryCode =
      typeof req.body?.countryCode === 'string' ? req.body.countryCode.slice(0, 8) : '+1';
    const language =
      typeof req.body?.language === 'string' ? req.body.language.slice(0, 8) : 'en';
    const displayName =
      typeof req.body?.displayName === 'string' ? req.body.displayName.trim().slice(0, 60) : '';

    const phoneE164 = normalizePhoneE164(rawPhone);
    if (!phoneE164 || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: 'Valid phone number and 6-digit code are required.' });
      return;
    }

    const challenge = db
      .prepare('SELECT * FROM otp_challenges WHERE phone_e164 = ? ORDER BY created_at DESC LIMIT 1')
      .get(phoneE164) as
      | { id: string; code_hash: string; expires_at: number; attempts: number }
      | undefined;

    const now = Date.now();
    if (!challenge || challenge.expires_at < now) {
      res.status(400).json({ error: 'Verification code expired. Request a new code.' });
      return;
    }

    if (challenge.attempts >= 5) {
      res.status(429).json({ error: 'Maximum verification attempts exceeded. Request a new code.' });
      return;
    }

    if (!verifyOtpHash(phoneE164, code, challenge.code_hash)) {
      db.prepare('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = ?').run(challenge.id);
      res.status(401).json({ error: 'Incorrect verification code.' });
      return;
    }

    db.prepare('DELETE FROM otp_challenges WHERE id = ?').run(challenge.id);

    let user = db.prepare('SELECT * FROM users WHERE phone_e164 = ?').get(phoneE164) as
      | UserRow
      | undefined;
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      const id = crypto.randomUUID();
      const qrToken = `EC-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
      db.prepare(
        `INSERT INTO users (id, phone_e164, country_iso, country_code, display_name, language, qr_token, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, phoneE164, countryIso, countryCode, displayName, language, qrToken, now, now);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
    } else {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, user.id);
      if (displayName && !user.display_name) {
        db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(displayName, user.id);
      }
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
    }

    const { rawToken } = createPersistentSession(
      user,
      String(req.headers['user-agent'] || '').slice(0, 200)
    );

    if (!isNewUser) {
      db.prepare(
        `INSERT INTO notifications (id, user_id, type, title, body, created_at)
         VALUES (?, ?, 'security', 'New sign-in detected', 'Your EASY CALL account was signed in via OTP verification.', ?)`
      ).run(crypto.randomUUID(), user.id, now);
    }

    setSessionCookie(req, res, rawToken, SESSION_TTL_MS);
    res.json({
      token: rawToken,
      isNewUser,
      user: getFullSelfView(user),
    });
  });

  router.post('/auth/recover', (req, res) => {
    const ip = getClientIp(req);
    if (!checkRateLimit(`recover-ip:${ip}`, 10, 15 * 60_000)) {
      res.status(429).json({ error: 'Too many recovery attempts.' });
      return;
    }

    const rawPhone = typeof req.body?.phoneE164 === 'string' ? req.body.phoneE164 : '';
    const pin = typeof req.body?.pin === 'string' ? req.body.pin.trim() : '';
    const phoneE164 = normalizePhoneE164(rawPhone);
    if (!phoneE164 || !/^\d{4,8}$/.test(pin)) {
      res.status(400).json({ error: 'Phone number and 4–8 digit recovery PIN are required.' });
      return;
    }

    const user = db.prepare('SELECT * FROM users WHERE phone_e164 = ?').get(phoneE164) as
      | UserRow
      | undefined;
    if (!user || !user.recovery_pin_hash || !verifyPin(pin, user.recovery_pin_hash)) {
      res.status(401).json({ error: 'Invalid phone number or recovery PIN.' });
      return;
    }

    const now = Date.now();
    const { rawToken } = createPersistentSession(
      user,
      String(req.headers['user-agent'] || '').slice(0, 200)
    );

    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, created_at)
       VALUES (?, ?, 'security', 'Account recovered via PIN', 'Your account was accessed using your Recovery PIN.', ?)`
    ).run(crypto.randomUUID(), user.id, now);

    setSessionCookie(req, res, rawToken, SESSION_TTL_MS);
    res.json({
      token: rawToken,
      user: getFullSelfView(user),
    });
  });

  router.post('/auth/logout', (req: AuthedRequest, res) => {
    const authHeader = req.headers.authorization;
    const token =
      typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
        ? authHeader.slice(7).trim()
        : req.cookies?.easycall_sid;

    if (token) {
      revokeSessionToken(token);
    }
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/users/me', requireAuth, (req: AuthedRequest, res) => {
    res.json({ user: getFullSelfView(req.user!), token: req.authToken });
  });

  router.patch('/users/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = req.body || {};

    const displayName =
      typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 60) : user.display_name;
    const bio = typeof body.bio === 'string' ? body.bio.trim().slice(0, 160) : user.bio;
    const language =
      typeof body.language === 'string' ? body.language.trim().slice(0, 8) : user.language;
    const discoverableByPhone =
      typeof body.discoverableByPhone === 'boolean'
        ? body.discoverableByPhone
          ? 1
          : 0
        : user.discoverable_by_phone;
    const discoverableByName =
      typeof body.discoverableByName === 'boolean'
        ? body.discoverableByName
          ? 1
          : 0
        : user.discoverable_by_name;
    const showOnlineStatus =
      typeof body.showOnlineStatus === 'boolean'
        ? body.showOnlineStatus
          ? 1
          : 0
        : user.show_online_status;
    const dataSaver =
      typeof body.dataSaver === 'boolean' ? (body.dataSaver ? 1 : 0) : user.data_saver;

    let recoveryPinHash = user.recovery_pin_hash;
    if (typeof body.recoveryPin === 'string' && body.recoveryPin.trim().length > 0) {
      const pin = body.recoveryPin.trim();
      if (!/^\d{4,8}$/.test(pin)) {
        res.status(400).json({ error: 'Recovery PIN must be 4 to 8 digits.' });
        return;
      }
      recoveryPinHash = hashPin(pin);
    }

    db.prepare(
      `UPDATE users
       SET display_name = ?, bio = ?, language = ?,
           discoverable_by_phone = ?, discoverable_by_name = ?,
           show_online_status = ?, data_saver = ?, recovery_pin_hash = ?
       WHERE id = ?`
    ).run(
      displayName,
      bio,
      language,
      discoverableByPhone,
      discoverableByName,
      showOnlineStatus,
      dataSaver,
      recoveryPinHash,
      user.id
    );

    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
    res.json({ user: getFullSelfView(updated) });
  });

  router.delete('/users/me', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const uploads = db
      .prepare('SELECT file_name FROM uploads WHERE owner_id = ?')
      .all(user.id) as Array<{ file_name: string }>;

    for (const u of uploads) {
      const safePath = resolveSafeUploadPath(u.file_name);
      if (safePath && fs.existsSync(safePath)) {
        fs.unlinkSync(safePath);
      }
    }

    revokeAllSessionsForDeletedUser(user.id);
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
    clearSessionCookie(req, res);
    res.json({ ok: true });
  });

  router.post('/uploads/image', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!checkRateLimit(`upload:${user.id}`, 20, 10 * 60_000)) {
      res.status(429).json({ error: 'Upload rate limit reached.' });
      return;
    }

    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
    const purpose =
      req.body?.purpose === 'chat'
        ? 'chat'
        : req.body?.purpose === 'story'
          ? 'story'
          : 'avatar';
    const match = dataUrl.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      res.status(400).json({ error: 'Only JPEG, PNG, or WebP images are permitted.' });
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
      res.status(400).json({ error: 'Image must be smaller than 2 MB.' });
      return;
    }

    const detected = detectImageMimeFromMagicBytes(buffer);
    if (!detected) {
      res.status(400).json({ error: 'Invalid or unsafe image file content.' });
      return;
    }

    const uploadId = crypto.randomUUID();
    const fileName = `${uploadId}.${detected.ext}`;
    const safePath = resolveSafeUploadPath(fileName);
    if (!safePath) {
      res.status(500).json({ error: 'Storage path validation failed.' });
      return;
    }

    fs.writeFileSync(safePath, buffer);
    db.prepare(
      `INSERT INTO uploads (id, owner_id, mime_type, file_name, size_bytes, purpose, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(uploadId, user.id, detected.mime, fileName, buffer.length, purpose, Date.now());

    if (purpose === 'avatar') {
      if (user.avatar_id) {
        const prev = db
          .prepare('SELECT file_name FROM uploads WHERE id = ? AND owner_id = ?')
          .get(user.avatar_id, user.id) as { file_name: string } | undefined;
        if (prev) {
          const prevPath = resolveSafeUploadPath(prev.file_name);
          if (prevPath && fs.existsSync(prevPath)) fs.unlinkSync(prevPath);
          db.prepare('DELETE FROM uploads WHERE id = ?').run(user.avatar_id);
        }
      }
      db.prepare('UPDATE users SET avatar_id = ? WHERE id = ?').run(uploadId, user.id);
    }

    res.json({
      uploadId,
      url: `/api/uploads/${uploadId}`,
    });
  });

  router.post(
    '/uploads/story-video',
    requireAuth,
    express.raw({
      type: ['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream'],
      limit: '25mb',
    }),
    (req: AuthedRequest, res) => {
      const user = req.user!;
      if (!checkRateLimit(`upload-video:${user.id}`, 10, 10 * 60_000)) {
        res.status(429).json({ error: 'Video upload rate limit reached.' });
        return;
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer || buffer.length === 0 || buffer.length > 25 * 1024 * 1024) {
        res.status(400).json({ error: 'Video must be non-empty and under 25 MB.' });
        return;
      }

      const detected = detectVideoMimeFromMagicBytes(buffer);
      if (!detected) {
        res.status(400).json({ error: 'Only MP4, MOV, or WebM videos are permitted.' });
        return;
      }

      const uploadId = crypto.randomUUID();
      const fileName = `${uploadId}.${detected.ext}`;
      const safePath = resolveSafeUploadPath(fileName);
      if (!safePath) {
        res.status(500).json({ error: 'Storage path validation failed.' });
        return;
      }

      fs.writeFileSync(safePath, buffer);
      db.prepare(
        `INSERT INTO uploads (id, owner_id, mime_type, file_name, size_bytes, purpose, created_at)
         VALUES (?, ?, ?, ?, ?, 'story_video', ?)`
      ).run(uploadId, user.id, detected.mime, fileName, buffer.length, Date.now());

      res.json({
        uploadId,
        url: `/api/uploads/${uploadId}`,
      });
    }
  );

  router.delete('/users/me/avatar', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (user.avatar_id) {
      const prev = db
        .prepare('SELECT file_name FROM uploads WHERE id = ? AND owner_id = ?')
        .get(user.avatar_id, user.id) as { file_name: string } | undefined;
      if (prev) {
        const prevPath = resolveSafeUploadPath(prev.file_name);
        if (prevPath && fs.existsSync(prevPath)) fs.unlinkSync(prevPath);
        db.prepare('DELETE FROM uploads WHERE id = ?').run(user.avatar_id);
      }
      db.prepare('UPDATE users SET avatar_id = NULL WHERE id = ?').run(user.id);
    }
    const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown as UserRow;
    res.json({ user: getFullSelfView(updated) });
  });

  router.get('/uploads/:id', (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(404).end();
      return;
    }
    const row = db
      .prepare('SELECT mime_type, file_name FROM uploads WHERE id = ?')
      .get(id) as { mime_type: string; file_name: string } | undefined;
    if (!row) {
      res.status(404).end();
      return;
    }
    const safePath = resolveSafeUploadPath(row.file_name);
    if (!safePath || !fs.existsSync(safePath)) {
      res.status(404).end();
      return;
    }
    const stat = fs.statSync(safePath);
    const total = stat.size;
    res.setHeader('Content-Type', row.mime_type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const rangeHeader = req.headers.range;
    if (typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=') && total > 0) {
      const parts = rangeHeader.replace(/^bytes=/, '').split('-');
      const start = Math.max(0, parseInt(parts[0] || '0', 10) || 0);
      const end = parts[1] ? Math.min(total - 1, parseInt(parts[1], 10)) : total - 1;
      if (start <= end && start < total) {
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
        res.setHeader('Content-Length', String(end - start + 1));
        fs.createReadStream(safePath, { start, end }).pipe(res);
        return;
      }
    }
    res.setHeader('Content-Length', String(total));
    fs.createReadStream(safePath).pipe(res);
  });

  router.get('/users/search', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!checkRateLimit(`search:${user.id}`, 60, 60_000)) {
      res.status(429).json({ error: 'Search rate limit reached. Please slow down.' });
      return;
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2) {
      res.json({ results: [] });
      return;
    }

    const exactPhone = normalizePhoneE164(q);
    const cleanedCode = q.replace(/\s+/g, '');
    const isCountryCode = /^\+[1-9]\d{0,3}$/.test(cleanedCode);
    const digitsOnly = q.replace(/\D/g, '');
    const isPhoneQuery =
      Boolean(exactPhone) ||
      (digitsOnly.length >= 3 && q.replace(/[\s\-()+.]/g, '') === digitsOnly);

    let rows: UserRow[] = [];

    if (exactPhone) {
      const noPlus = exactPhone.slice(1);
      rows = db
        .prepare(
          `SELECT * FROM users
           WHERE id != ? AND (phone_e164 = ? OR phone_e164 LIKE ?)
           ORDER BY last_seen_at DESC
           LIMIT 20`
        )
        .all(user.id, exactPhone, `%${noPlus}%`) as unknown as UserRow[];
    } else if (isCountryCode) {
      const prefixPattern = `${cleanedCode}%`;
      rows = db
        .prepare(
          `SELECT * FROM users
           WHERE (country_code = ? OR phone_e164 LIKE ?) AND id != ?
           ORDER BY last_seen_at DESC
           LIMIT 25`
        )
        .all(cleanedCode, prefixPattern, user.id) as unknown as UserRow[];
    } else if (isPhoneQuery) {
      const strippedDigits = digitsOnly.replace(/^0+/, '') || digitsOnly;
      const containsDigits = `%${digitsOnly}%`;
      const containsStripped = `%${strippedDigits}%`;
      rows = db
        .prepare(
          `SELECT * FROM users
           WHERE id != ? AND (phone_e164 LIKE ? OR phone_e164 LIKE ?)
           ORDER BY last_seen_at DESC
           LIMIT 25`
        )
        .all(user.id, containsDigits, containsStripped) as unknown as UserRow[];
    } else {
      const pattern = `%${q}%`;
      rows = db
        .prepare(
          `SELECT * FROM users
           WHERE id != ? AND (display_name LIKE ? COLLATE NOCASE OR phone_e164 LIKE ? OR qr_token = ?)
           ORDER BY last_seen_at DESC
           LIMIT 25`
        )
        .all(user.id, pattern, pattern, q) as unknown as UserRow[];
    }

    const results = rows
      .filter((r) => !isBlockedBetween(user.id, r.id))
      .map((r) => {
        const friend = areFriends(user.id, r.id);
        const pendingOut =
          !friend &&
          Boolean(
            db
              .prepare(
                `SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
              )
              .get(user.id, r.id)
          );
        const pendingIn =
          !friend &&
          Boolean(
            db
              .prepare(
                `SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
              )
              .get(r.id, user.id)
          );
        return {
          ...getPublicUserView(r, true),
          online: r.show_online_status ? isUserOnline(r.id) : false,
          showOnlineStatus: Boolean(r.show_online_status),
          isFriend: friend,
          requestStatus: friend
            ? 'accepted'
            : pendingOut
              ? 'outgoing_pending'
              : pendingIn
                ? 'incoming_pending'
                : 'none',
        };
      });

    res.json({ results });
  });

  router.get('/users/by-qr/:qrToken', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rawToken = req.params.qrToken.trim();
    const cleaned = rawToken.replace(/^easycall:\/\/user\//i, '').trim();

    const target = db.prepare('SELECT * FROM users WHERE qr_token = ?').get(cleaned) as
      | UserRow
      | undefined;

    if (!target || target.id === user.id || isBlockedBetween(user.id, target.id)) {
      res.status(404).json({ error: 'User QR code not found.' });
      return;
    }

    const friend = areFriends(user.id, target.id);
    const pendingOut = Boolean(
      db
        .prepare(
          `SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
        )
        .get(user.id, target.id)
    );
    const pendingIn = Boolean(
      db
        .prepare(
          `SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
        )
        .get(target.id, user.id)
    );

    res.json({
      user: {
        ...getPublicUserView(target, friend),
        isFriend: friend,
        requestStatus: friend
          ? 'accepted'
          : pendingOut
            ? 'outgoing_pending'
            : pendingIn
              ? 'incoming_pending'
              : 'none',
      },
    });
  });

  router.post('/contacts/match', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!checkRateLimit(`contacts-match:${user.id}`, 30, 10 * 60_000)) {
      res.status(429).json({ error: 'Contact sync rate limit exceeded.' });
      return;
    }

    const rawNumbers = Array.isArray(req.body?.numbers) ? req.body.numbers : [];
    const normalizedSet = new Set<string>();
    for (const item of rawNumbers.slice(0, 1500)) {
      if (typeof item === 'string') {
        const candidates = normalizeContactCandidates(item, user.country_code || '+1');
        for (const e164 of candidates) {
          if (e164 !== user.phone_e164) {
            normalizedSet.add(e164);
          }
        }
      }
    }

    const matched: Array<Record<string, unknown>> = [];
    const seenIds = new Set<string>();
    const stmt = db.prepare(
      `SELECT * FROM users WHERE phone_e164 = ? AND discoverable_by_phone = 1 LIMIT 1`
    );
    const saveSyncedStmt = db.prepare(
      `INSERT OR IGNORE INTO synced_contacts (owner_id, contact_user_id, created_at) VALUES (?, ?, ?)`
    );
    const now = Date.now();

    for (const phone of normalizedSet) {
      const target = stmt.get(phone) as UserRow | undefined;
      if (target && target.id !== user.id && !seenIds.has(target.id) && !isBlockedBetween(user.id, target.id)) {
        seenIds.add(target.id);
        saveSyncedStmt.run(user.id, target.id, now);
        const friend = areFriends(user.id, target.id);
        const pendingOut = Boolean(
          db
            .prepare(
              `SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
            )
            .get(user.id, target.id)
        );
        const pendingIn = Boolean(
          db
            .prepare(
              `SELECT 1 FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
            )
            .get(target.id, user.id)
        );
        matched.push({
          ...getPublicUserView(target, true),
          lastSeenAt: target.show_online_status ? target.last_seen_at : 0,
          online: target.show_online_status ? isUserOnline(target.id) : false,
          showOnlineStatus: Boolean(target.show_online_status),
          isFriend: friend,
          requestStatus: friend
            ? 'accepted'
            : pendingOut
              ? 'outgoing_pending'
              : pendingIn
                ? 'incoming_pending'
                : 'none',
        });
      }
    }

    res.json({ matches: matched });
  });

  router.get('/friends', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare(
        `SELECT DISTINCT u.* FROM users u
         WHERE u.id != ? AND (
           u.id IN (
             SELECT CASE WHEN f.user_a = ? THEN f.user_b ELSE f.user_a END
             FROM friendships f WHERE f.user_a = ? OR f.user_b = ?
           )
           OR u.id IN (
             SELECT sc.contact_user_id FROM synced_contacts sc WHERE sc.owner_id = ?
           )
         )
         ORDER BY u.display_name ASC, u.phone_e164 ASC`
      )
      .all(user.id, user.id, user.id, user.id, user.id) as unknown as UserRow[];

    const friends = rows
      .filter((r) => !isBlockedBetween(user.id, r.id))
      .map((r) => ({
        ...getPublicUserView(r, true),
        lastSeenAt: r.show_online_status ? r.last_seen_at : 0,
        online: r.show_online_status ? isUserOnline(r.id) : false,
        showOnlineStatus: Boolean(r.show_online_status),
      }));

    res.json({ friends });
  });

  router.delete('/friends/:friendId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const [a, b] = normalizePair(user.id, req.params.friendId);
    db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(a, b);
    res.json({ ok: true });
  });

  router.get('/friend-requests', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const incoming = db
      .prepare(
        `SELECT fr.id AS fr_id, fr.created_at AS fr_created_at, u.*
         FROM friend_requests fr
         INNER JOIN users u ON u.id = fr.from_user_id
         WHERE fr.to_user_id = ? AND fr.status = 'pending'
         ORDER BY fr.created_at DESC`
      )
      .all(user.id) as unknown as Array<{ fr_id: string; fr_created_at: number } & UserRow>;

    const outgoing = db
      .prepare(
        `SELECT fr.id AS fr_id, fr.created_at AS fr_created_at, u.*
         FROM friend_requests fr
         INNER JOIN users u ON u.id = fr.to_user_id
         WHERE fr.from_user_id = ? AND fr.status = 'pending'
         ORDER BY fr.created_at DESC`
      )
      .all(user.id) as unknown as Array<{ fr_id: string; fr_created_at: number } & UserRow>;

    res.json({
      incoming: incoming.map((r) => ({
        requestId: r.fr_id,
        createdAt: r.fr_created_at,
        user: getPublicUserView(r, false),
      })),
      outgoing: outgoing.map((r) => ({
        requestId: r.fr_id,
        createdAt: r.fr_created_at,
        user: getPublicUserView(r, false),
      })),
    });
  });

  router.post('/friend-requests', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!checkRateLimit(`fr-send:${user.id}`, 20, 60 * 60_000)) {
      res.status(429).json({ error: 'Friend request rate limit exceeded.' });
      return;
    }

    const toUserId = typeof req.body?.toUserId === 'string' ? req.body.toUserId : '';
    if (!toUserId || toUserId === user.id) {
      res.status(400).json({ error: 'Invalid target user.' });
      return;
    }

    const target = db.prepare('SELECT * FROM users WHERE id = ?').get(toUserId) as
      | UserRow
      | undefined;
    if (!target || isBlockedBetween(user.id, toUserId)) {
      res.status(403).json({ error: 'Cannot send friend request to this user.' });
      return;
    }

    if (areFriends(user.id, toUserId)) {
      res.status(409).json({ error: 'Already connected as friends.' });
      return;
    }

    const reversePending = db
      .prepare(
        `SELECT id FROM friend_requests WHERE from_user_id = ? AND to_user_id = ? AND status = 'pending'`
      )
      .get(toUserId, user.id) as { id: string } | undefined;

    if (reversePending) {
      res.status(409).json({
        error: 'This person already sent you a request. Accept it in Friend Requests.',
      });
      return;
    }

    const now = Date.now();
    const existing = db
      .prepare('SELECT id, status FROM friend_requests WHERE from_user_id = ? AND to_user_id = ?')
      .get(user.id, toUserId) as { id: string; status: string } | undefined;

    let requestId: string;
    if (existing) {
      if (existing.status === 'pending') {
        res.status(409).json({ error: 'Friend request already pending.' });
        return;
      }
      requestId = existing.id;
      db.prepare(`UPDATE friend_requests SET status = 'pending', updated_at = ? WHERE id = ?`).run(
        now,
        requestId
      );
    } else {
      requestId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO friend_requests (id, from_user_id, to_user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      ).run(requestId, user.id, toUserId, now, now);
    }

    const senderName = user.display_name || user.phone_e164;
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, related_user_id, created_at)
       VALUES (?, ?, 'friend_request', 'New Friend Request', ?, ?, ?)`
    ).run(crypto.randomUUID(), toUserId, `${senderName} wants to connect with you.`, user.id, now);

    sendToUser(toUserId, {
      type: 'friend_request:new',
      requestId,
      fromUser: getPublicUserView(user, false),
    });
    sendToUser(toUserId, { type: 'notifications:refresh' });

    res.json({ ok: true, requestId });
  });

  router.post('/friend-requests/:id/respond', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const action = req.body?.action === 'accept' ? 'accept' : req.body?.action === 'reject' ? 'reject' : null;
    if (!action) {
      res.status(400).json({ error: 'Action must be accept or reject.' });
      return;
    }

    const fr = db
      .prepare(`SELECT * FROM friend_requests WHERE id = ? AND to_user_id = ? AND status = 'pending'`)
      .get(req.params.id, user.id) as
      | { id: string; from_user_id: string; to_user_id: string }
      | undefined;

    if (!fr) {
      res.status(404).json({ error: 'Pending friend request not found.' });
      return;
    }

    const now = Date.now();
    if (action === 'reject') {
      db.prepare(`UPDATE friend_requests SET status = 'rejected', updated_at = ? WHERE id = ?`).run(
        now,
        fr.id
      );
      db.prepare(
        `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND related_user_id = ? AND type = 'friend_request'`
      ).run(user.id, fr.from_user_id);
      sendToUser(user.id, { type: 'notifications:refresh' });
      sendToUser(fr.from_user_id, { type: 'friends:refresh' });
      res.json({ ok: true, status: 'rejected' });
      return;
    }

    if (isBlockedBetween(user.id, fr.from_user_id)) {
      res.status(403).json({ error: 'Cannot accept blocked user.' });
      return;
    }

    db.prepare(`UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?`).run(
      now,
      fr.id
    );
    const [a, b] = normalizePair(fr.from_user_id, fr.to_user_id);
    db.prepare(
      `INSERT OR IGNORE INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?)`
    ).run(a, b, now);
    db.prepare(
      `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND related_user_id = ? AND type = 'friend_request'`
    ).run(user.id, fr.from_user_id);

    const accepterName = user.display_name || user.phone_e164;
    db.prepare(
      `INSERT INTO notifications (id, user_id, type, title, body, related_user_id, created_at)
       VALUES (?, ?, 'friend_accepted', 'Friend Request Accepted', ?, ?, ?)`
    ).run(
      crypto.randomUUID(),
      fr.from_user_id,
      `${accepterName} accepted your friend request. You can now call and message.`,
      user.id,
      now
    );

    sendToUser(fr.from_user_id, {
      type: 'friend_request:accepted',
      friend: getPublicUserView(user, true),
    });
    sendToUser(fr.from_user_id, { type: 'friends:refresh' });
    sendToUser(fr.from_user_id, { type: 'notifications:refresh' });
    sendToUser(user.id, { type: 'friends:refresh' });
    sendToUser(user.id, { type: 'notifications:refresh' });

    res.json({ ok: true, status: 'accepted' });
  });

  router.get('/blocks', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare(
        `SELECT u.*, b.created_at AS blocked_at
         FROM blocks b
         INNER JOIN users u ON u.id = b.blocked_id
         WHERE b.blocker_id = ?
         ORDER BY b.created_at DESC`
      )
      .all(user.id) as unknown as Array<UserRow & { blocked_at: number }>;

    res.json({
      blocked: rows.map((r) => ({
        ...getPublicUserView(r, false),
        blockedAt: r.blocked_at,
      })),
    });
  });

  router.post('/blocks', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const blockedId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    if (!blockedId || blockedId === user.id) {
      res.status(400).json({ error: 'Invalid user to block.' });
      return;
    }

    const now = Date.now();
    db.prepare(`INSERT OR IGNORE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`).run(
      user.id,
      blockedId,
      now
    );

    const [a, b] = normalizePair(user.id, blockedId);
    db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?').run(a, b);
    db.prepare(
      `DELETE FROM friend_requests
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)`
    ).run(user.id, blockedId, blockedId, user.id);

    sendToUser(blockedId, { type: 'friends:refresh' });
    res.json({ ok: true });
  });

  router.delete('/blocks/:userId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    db.prepare('DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?').run(
      user.id,
      req.params.userId
    );
    res.json({ ok: true });
  });

  router.post('/reports', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!checkRateLimit(`report:${user.id}`, 10, 60 * 60_000)) {
      res.status(429).json({ error: 'Report rate limit reached.' });
      return;
    }

    const reportedId = typeof req.body?.userId === 'string' ? req.body.userId : '';
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 80) : '';
    const details =
      typeof req.body?.details === 'string' ? req.body.details.trim().slice(0, 500) : '';

    if (!reportedId || reportedId === user.id || !reason) {
      res.status(400).json({ error: 'Target user and reason are required.' });
      return;
    }

    db.prepare(
      `INSERT INTO reports (id, reporter_id, reported_id, reason, details, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), user.id, reportedId, reason, details, Date.now());

    res.json({ ok: true });
  });

  router.get('/calls', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare(
        `SELECT c.*,
                cu.display_name AS caller_name, cu.phone_e164 AS caller_phone, cu.avatar_id AS caller_avatar, cu.country_iso AS caller_country,
                ru.display_name AS callee_name, ru.phone_e164 AS callee_phone, ru.avatar_id AS callee_avatar, ru.country_iso AS callee_country
         FROM call_records c
         INNER JOIN users cu ON cu.id = c.caller_id
         INNER JOIN users ru ON ru.id = c.callee_id
         WHERE (c.caller_id = ? AND c.hidden_for_caller = 0)
            OR (c.callee_id = ? AND c.hidden_for_callee = 0)
         ORDER BY c.started_at DESC
         LIMIT 100`
      )
      .all(user.id, user.id) as Array<{
      id: string;
      caller_id: string;
      callee_id: string;
      call_type: 'audio' | 'video';
      status: string;
      started_at: number;
      ended_at: number | null;
      duration_sec: number;
      callee_seen: number;
      caller_name: string;
      caller_phone: string;
      caller_avatar: string | null;
      caller_country: string;
      callee_name: string;
      callee_phone: string;
      callee_avatar: string | null;
      callee_country: string;
    }>;

    const calls = rows.map((r) => {
      const isOutgoing = r.caller_id === user.id;
      const peerId = isOutgoing ? r.callee_id : r.caller_id;
      const peerName = isOutgoing
        ? r.callee_name || r.callee_phone
        : r.caller_name || r.caller_phone;
      const peerAvatar = isOutgoing ? r.callee_avatar : r.caller_avatar;
      const peerCountry = isOutgoing ? r.callee_country : r.caller_country;
      const mappedStatus = !isOutgoing && r.status === 'cancelled' ? 'missed' : r.status;
      return {
        id: r.id,
        peerId,
        peerName,
        peerAvatarUrl: peerAvatar ? `/api/uploads/${peerAvatar}` : null,
        peerCountryIso: peerCountry,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        callType: r.call_type,
        status: mappedStatus,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        durationSec: r.duration_sec,
        calleeSeen: isOutgoing ? true : Boolean(r.callee_seen),
        canCallback: !isBlockedBetween(user.id, peerId),
      };
    });

    res.json({ calls });
  });

  router.post('/calls/mark-seen', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const peerId = typeof req.body?.peerId === 'string' ? req.body.peerId : '';
    if (peerId) {
      db.prepare(
        `UPDATE call_records SET callee_seen = 1
         WHERE callee_id = ? AND caller_id = ? AND callee_seen = 0`
      ).run(user.id, peerId);
    } else {
      db.prepare(
        `UPDATE call_records SET callee_seen = 1
         WHERE callee_id = ? AND callee_seen = 0`
      ).run(user.id);
    }
    res.json({ ok: true });
  });

  router.get('/home-feed', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const peerActivity = new Map<
      string,
      {
        lastActivityAt: number;
        lastCall?: {
          id: string;
          direction: 'incoming' | 'outgoing';
          callType: 'audio' | 'video';
          status: string;
          durationSec: number;
          startedAt: number;
        };
        lastMessage?: {
          id: string;
          senderId: string;
          body: string;
          hasImage: boolean;
          createdAt: number;
        };
        unreadCount: number;
        missedCount: number;
      }
    >();

    const callRows = db
      .prepare(
        `SELECT id, caller_id, callee_id, call_type, status, started_at, duration_sec, callee_seen
         FROM call_records
         WHERE (caller_id = ? AND hidden_for_caller = 0)
            OR (callee_id = ? AND hidden_for_callee = 0)
         ORDER BY started_at DESC
         LIMIT 200`
      )
      .all(user.id, user.id) as Array<{
      id: string;
      caller_id: string;
      callee_id: string;
      call_type: 'audio' | 'video';
      status: string;
      started_at: number;
      duration_sec: number;
      callee_seen: number;
    }>;

    for (const c of callRows) {
      const isOutgoing = c.caller_id === user.id;
      const peerId = isOutgoing ? c.callee_id : c.caller_id;
      if (peerId === user.id) continue;
      const existing = peerActivity.get(peerId) || {
        lastActivityAt: 0,
        unreadCount: 0,
        missedCount: 0,
      };
      const mappedStatus = !isOutgoing && c.status === 'cancelled' ? 'missed' : c.status;
      if (!existing.lastCall) {
        existing.lastCall = {
          id: c.id,
          direction: isOutgoing ? 'outgoing' : 'incoming',
          callType: c.call_type,
          status: mappedStatus,
          durationSec: c.duration_sec,
          startedAt: c.started_at,
        };
      }
      if (
        !isOutgoing &&
        !c.callee_seen &&
        (c.status === 'missed' || c.status === 'rejected' || c.status === 'cancelled')
      ) {
        existing.missedCount += 1;
      }
      if (c.started_at > existing.lastActivityAt) {
        existing.lastActivityAt = c.started_at;
      }
      peerActivity.set(peerId, existing);
    }

    const msgRows = db
      .prepare(
        `SELECT id, sender_id, receiver_id, body, image_id, status, created_at
         FROM messages
         WHERE sender_id = ? OR receiver_id = ?
         ORDER BY created_at DESC
         LIMIT 300`
      )
      .all(user.id, user.id) as Array<{
      id: string;
      sender_id: string;
      receiver_id: string;
      body: string;
      image_id: string | null;
      status: string;
      created_at: number;
    }>;

    for (const m of msgRows) {
      const peerId = m.sender_id === user.id ? m.receiver_id : m.sender_id;
      if (peerId === user.id) continue;
      const existing = peerActivity.get(peerId) || {
        lastActivityAt: 0,
        unreadCount: 0,
        missedCount: 0,
      };
      if (!existing.lastMessage) {
        existing.lastMessage = {
          id: m.id,
          senderId: m.sender_id,
          body: m.body,
          hasImage: Boolean(m.image_id),
          createdAt: m.created_at,
        };
      }
      if (m.receiver_id === user.id && m.status !== 'read') {
        existing.unreadCount += 1;
      }
      if (m.created_at > existing.lastActivityAt) {
        existing.lastActivityAt = m.created_at;
      }
      peerActivity.set(peerId, existing);
    }

    const friendRows = db
      .prepare(
        `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS peer_id, created_at
         FROM friendships WHERE user_a = ? OR user_b = ?`
      )
      .all(user.id, user.id, user.id) as Array<{ peer_id: string; created_at: number }>;

    for (const f of friendRows) {
      if (f.peer_id === user.id || peerActivity.has(f.peer_id)) continue;
      peerActivity.set(f.peer_id, {
        lastActivityAt: f.created_at,
        unreadCount: 0,
        missedCount: 0,
      });
    }

    const items: Array<Record<string, unknown>> = [];
    const userStmt = db.prepare('SELECT * FROM users WHERE id = ?');

    for (const [peerId, info] of peerActivity.entries()) {
      if (isBlockedBetween(user.id, peerId)) continue;
      const peerRow = userStmt.get(peerId) as UserRow | undefined;
      if (!peerRow) continue;
      items.push({
        peer: {
          ...getPublicUserView(peerRow, true),
          lastSeenAt: peerRow.show_online_status ? peerRow.last_seen_at : 0,
          online: peerRow.show_online_status ? isUserOnline(peerRow.id) : false,
          showOnlineStatus: Boolean(peerRow.show_online_status),
        },
        lastActivityAt: info.lastActivityAt,
        lastCall: info.lastCall || null,
        lastMessage: info.lastMessage || null,
        unreadCount: info.unreadCount,
        missedCount: info.missedCount,
      });
    }

    items.sort((a, b) => Number(b.lastActivityAt) - Number(a.lastActivityAt));
    res.json({ items });
  });

  router.delete('/calls', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    db.prepare('UPDATE call_records SET hidden_for_caller = 1 WHERE caller_id = ?').run(user.id);
    db.prepare('UPDATE call_records SET hidden_for_callee = 1, callee_seen = 1 WHERE callee_id = ?').run(user.id);
    res.json({ ok: true });
  });

  router.get('/history/snapshot', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const msgRows = db
      .prepare(
        `SELECT m.id, m.sender_id, m.receiver_id, m.body, m.image_id, m.status, m.created_at,
                su.phone_e164 AS sender_phone, ru.phone_e164 AS receiver_phone
         FROM messages m
         INNER JOIN users su ON su.id = m.sender_id
         INNER JOIN users ru ON ru.id = m.receiver_id
         WHERE m.sender_id = ? OR m.receiver_id = ?
         ORDER BY m.created_at DESC
         LIMIT 600`
      )
      .all(user.id, user.id) as Array<{
      id: string;
      sender_id: string;
      receiver_id: string;
      body: string;
      image_id: string | null;
      status: string;
      created_at: number;
      sender_phone: string;
      receiver_phone: string;
    }>;

    const threads: Record<string, { peerId: string; peerPhone: string; messages: Array<Record<string, unknown>> }> = {};
    for (let i = msgRows.length - 1; i >= 0; i--) {
      const m = msgRows[i];
      const senderIsSelf = m.sender_id === user.id;
      const peerId = senderIsSelf ? m.receiver_id : m.sender_id;
      const peerPhone = senderIsSelf ? m.receiver_phone : m.sender_phone;
      if (!peerId || !peerPhone || isBlockedBetween(user.id, peerId)) continue;
      if (!threads[peerPhone]) {
        threads[peerPhone] = { peerId, peerPhone, messages: [] };
      }
      threads[peerPhone].messages.push({
        id: m.id,
        senderId: m.sender_id,
        receiverId: m.receiver_id,
        body: m.body,
        imageUrl: m.image_id ? `/api/uploads/${m.image_id}` : null,
        status: m.status,
        createdAt: m.created_at,
      });
    }

    res.json({ threads });
  });

  router.post('/history/restore', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const now = Date.now();
    const rawPeers = Array.isArray(req.body?.peers) ? req.body.peers.slice(0, 200) : [];
    const rawCalls = Array.isArray(req.body?.calls) ? req.body.calls.slice(0, 200) : [];
    const rawMessages = Array.isArray(req.body?.messages) ? req.body.messages.slice(0, 500) : [];

    const peerByPhone = new Map<string, UserRow>();
    const selectByPhone = db.prepare('SELECT * FROM users WHERE phone_e164 = ?');
    const insertStubPeer = db.prepare(
      `INSERT OR IGNORE INTO users (id, phone_e164, country_iso, country_code, display_name, qr_token, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertSyncedContact = db.prepare(
      `INSERT OR IGNORE INTO synced_contacts (owner_id, contact_user_id, created_at) VALUES (?, ?, ?)`
    );

    const resolveOrEnsurePeer = (rawPhone: string, displayName = '', countryIso = 'US'): UserRow | null => {
      const phone = normalizePhoneE164(rawPhone);
      if (!phone || phone === user.phone_e164) return null;
      const cached = peerByPhone.get(phone);
      if (cached) return cached;

      let peer = selectByPhone.get(phone) as UserRow | undefined;
      if (!peer) {
        const peerId = crypto.randomUUID();
        const qrToken = `EC-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
        const safeName = displayName.trim().slice(0, 60);
        const safeIso = /^[A-Z]{2}$/.test(countryIso.toUpperCase()) ? countryIso.toUpperCase() : 'US';
        insertStubPeer.run(peerId, phone, safeIso, user.country_code || '+1', safeName, qrToken, now, now);
        peer = selectByPhone.get(phone) as UserRow | undefined;
      }
      if (!peer || isBlockedBetween(user.id, peer.id)) return null;
      insertSyncedContact.run(user.id, peer.id, now);
      peerByPhone.set(phone, peer);
      return peer;
    };

    for (const p of rawPeers) {
      if (!p || typeof p !== 'object') continue;
      const phone = typeof p.phoneE164 === 'string' ? p.phoneE164 : '';
      const name = typeof p.displayName === 'string' ? p.displayName : '';
      const iso = typeof p.countryIso === 'string' ? p.countryIso : 'US';
      resolveOrEnsurePeer(phone, name, iso);
    }

    let restoredCalls = 0;
    const findExistingCall = db.prepare(
      `SELECT 1 FROM call_records
       WHERE id = ? OR (caller_id = ? AND callee_id = ? AND started_at = ?)`
    );
    const insertCall = db.prepare(
      `INSERT OR IGNORE INTO call_records
         (id, caller_id, callee_id, call_type, status, started_at, answered_at, ended_at, duration_sec, callee_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );

    for (const c of rawCalls) {
      if (!c || typeof c !== 'object') continue;
      const peerPhone = typeof c.peerPhone === 'string' ? c.peerPhone : '';
      const peerName = typeof c.peerName === 'string' ? c.peerName : '';
      const peerIso = typeof c.peerCountryIso === 'string' ? c.peerCountryIso : 'US';
      const peer = resolveOrEnsurePeer(peerPhone, peerName, peerIso);
      if (!peer) continue;

      const direction = c.direction === 'outgoing' ? 'outgoing' : 'incoming';
      const callType = c.callType === 'video' ? 'video' : 'audio';
      const allowedStatuses = new Set(['completed', 'missed', 'rejected', 'cancelled']);
      const status = typeof c.status === 'string' && allowedStatuses.has(c.status) ? c.status : 'missed';
      const startedAt = Number(c.startedAt);
      if (!Number.isFinite(startedAt) || startedAt <= 0 || startedAt > now + 60_000) continue;
      const endedAtRaw = Number(c.endedAt);
      const endedAt = Number.isFinite(endedAtRaw) && endedAtRaw >= startedAt ? endedAtRaw : startedAt;
      const durationSec = Math.max(0, Math.min(86400, Math.floor(Number(c.durationSec) || 0)));

      const callerId = direction === 'outgoing' ? user.id : peer.id;
      const calleeId = direction === 'outgoing' ? peer.id : user.id;
      const callId =
        typeof c.id === 'string' && c.id.length >= 8 && c.id.length <= 64
          ? c.id
          : crypto.randomUUID();

      if (findExistingCall.get(callId, callerId, calleeId, startedAt)) continue;
      const answeredAt = status === 'completed' ? startedAt : null;
      insertCall.run(callId, callerId, calleeId, callType, status, startedAt, answeredAt, endedAt, durationSec);
      restoredCalls += 1;
    }

    let restoredMessages = 0;
    const findUpload = db.prepare('SELECT id FROM uploads WHERE id = ?');
    const findExistingMsg = db.prepare(
      `SELECT 1 FROM messages
       WHERE id = ? OR (sender_id = ? AND receiver_id = ? AND created_at = ? AND body = ?)`
    );
    const insertMsg = db.prepare(
      `INSERT OR IGNORE INTO messages (id, sender_id, receiver_id, body, image_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    for (const m of rawMessages) {
      if (!m || typeof m !== 'object') continue;
      const peerPhone = typeof m.peerPhone === 'string' ? m.peerPhone : '';
      const peer = resolveOrEnsurePeer(peerPhone);
      if (!peer) continue;

      const senderIsSelf = Boolean(m.senderIsSelf);
      const senderId = senderIsSelf ? user.id : peer.id;
      const receiverId = senderIsSelf ? peer.id : user.id;
      const createdAt = Number(m.createdAt);
      if (!Number.isFinite(createdAt) || createdAt <= 0 || createdAt > now + 60_000) continue;

      let body = typeof m.body === 'string' ? m.body.trim().slice(0, 2000) : '';
      let imageId: string | null = null;
      if (typeof m.imageUrl === 'string') {
        const match = m.imageUrl.match(/\/api\/uploads\/([0-9a-f-]{36})$/i);
        if (match && findUpload.get(match[1])) {
          imageId = match[1];
        }
      }
      if (!body && !imageId) {
        body = '[Photo]';
      }
      const msgStatus = m.status === 'read' || m.status === 'delivered' ? m.status : 'sent';
      const msgId =
        typeof m.id === 'string' && m.id.length >= 8 && m.id.length <= 64
          ? m.id
          : crypto.randomUUID();

      if (findExistingMsg.get(msgId, senderId, receiverId, createdAt, body)) continue;
      insertMsg.run(msgId, senderId, receiverId, body, imageId, msgStatus, createdAt);
      restoredMessages += 1;
    }

    res.json({ ok: true, restoredCalls, restoredMessages });
  });

  router.get('/messages/:friendId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const friendId = req.params.friendId;
    const targetExists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(friendId);
    if (!targetExists || isBlockedBetween(user.id, friendId)) {
      res.status(403).json({ error: 'Unable to open chat with this user.' });
      return;
    }

    db.prepare(
      `UPDATE messages SET status = 'read'
       WHERE sender_id = ? AND receiver_id = ? AND status != 'read'`
    ).run(friendId, user.id);

    const rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
         ORDER BY created_at ASC
         LIMIT 200`
      )
      .all(user.id, friendId, friendId, user.id) as Array<{
      id: string;
      sender_id: string;
      receiver_id: string;
      body: string;
      image_id: string | null;
      status: string;
      created_at: number;
    }>;

    res.json({
      messages: rows.map((m) => ({
        id: m.id,
        senderId: m.sender_id,
        receiverId: m.receiver_id,
        body: m.body,
        imageUrl: m.image_id ? `/api/uploads/${m.image_id}` : null,
        status: m.status,
        createdAt: m.created_at,
      })),
    });
  });

  router.post('/messages/:friendId', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const friendId = req.params.friendId;
    const targetExists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(friendId);
    if (!targetExists || isBlockedBetween(user.id, friendId)) {
      res.status(403).json({ error: 'Unable to send message to this user.' });
      return;
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim().slice(0, 2000) : '';
    const imageId =
      typeof req.body?.imageId === 'string' && /^[0-9a-f-]{36}$/i.test(req.body.imageId)
        ? req.body.imageId
        : null;

    if (!body && !imageId) {
      res.status(400).json({ error: 'Message text or image is required.' });
      return;
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const delivered = isUserOnline(friendId) ? 'delivered' : 'sent';

    db.prepare(
      `INSERT INTO messages (id, sender_id, receiver_id, body, image_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, user.id, friendId, body, imageId, delivered, now);

    const message = {
      id,
      senderId: user.id,
      receiverId: friendId,
      body,
      imageUrl: imageId ? `/api/uploads/${imageId}` : null,
      status: delivered,
      createdAt: now,
    };

    sendToUser(friendId, {
      type: 'chat:message',
      message,
      senderName: user.display_name || user.phone_e164,
    });

    res.json({ message });
  });

  router.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(user.id) as Array<{
      id: string;
      type: string;
      title: string;
      body: string;
      related_user_id: string | null;
      is_read: number;
      created_at: number;
    }>;

    res.json({
      notifications: rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        relatedUserId: n.related_user_id,
        isRead: Boolean(n.is_read),
        createdAt: n.created_at,
      })),
    });
  });

  router.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(user.id);
    res.json({ ok: true });
  });

  router.post('/devices/token', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const platform =
      req.body?.platform === 'android' || req.body?.platform === 'ios' ? req.body.platform : 'web';
    const token = typeof req.body?.token === 'string' ? req.body.token.trim().slice(0, 512) : '';
    if (!token) {
      res.status(400).json({ error: 'Token is required.' });
      return;
    }

    db.prepare(
      `INSERT OR IGNORE INTO device_tokens (id, user_id, platform, token, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(crypto.randomUUID(), user.id, platform, token, Date.now());

    res.json({ ok: true });
  });

  router.get('/events/stream', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    registerBackgroundStream(user.id, res);
    res.write(`data: ${JSON.stringify({ type: 'sse:ready', userId: user.id })}\n\n`);

    const cutoff = Date.now() - 48_000;
    const ringing = db
      .prepare(
        `SELECT id, caller_id, call_type FROM call_records
         WHERE callee_id = ? AND status = 'ringing' AND started_at > ?
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(user.id, cutoff) as { id: string; caller_id: string; call_type: 'audio' | 'video' } | undefined;

    if (ringing) {
      const caller = db.prepare('SELECT * FROM users WHERE id = ?').get(ringing.caller_id) as
        | UserRow
        | undefined;
      if (caller && !isBlockedBetween(user.id, caller.id)) {
        res.write(
          `data: ${JSON.stringify({
            type: 'call:incoming',
            callId: ringing.id,
            callType: ringing.call_type,
            caller: getPublicUserView(caller, true),
          })}\n\n`
        );
        notifyCallerRinging(ringing.id, ringing.caller_id);
      }
    }

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        res.write(': ping\n\n');
      }
    }, 9_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unregisterBackgroundStream(user.id, res);
    });
  });

  router.get('/calls/active-incoming', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const cutoff = Date.now() - 48_000;
    const ringing = db
      .prepare(
        `SELECT id, caller_id, call_type, started_at FROM call_records
         WHERE callee_id = ? AND status = 'ringing' AND started_at > ?
         ORDER BY started_at DESC LIMIT 1`
      )
      .get(user.id, cutoff) as
      | { id: string; caller_id: string; call_type: 'audio' | 'video'; started_at: number }
      | undefined;

    if (!ringing) {
      res.json({ incoming: null });
      return;
    }

    const caller = db.prepare('SELECT * FROM users WHERE id = ?').get(ringing.caller_id) as
      | UserRow
      | undefined;
    if (!caller || isBlockedBetween(user.id, caller.id)) {
      res.json({ incoming: null });
      return;
    }

    notifyCallerRinging(ringing.id, ringing.caller_id);
    res.json({
      incoming: {
        callId: ringing.id,
        callType: ringing.call_type,
        startedAt: ringing.started_at,
        caller: getPublicUserView(caller, true),
      },
    });
  });

  router.post('/calls/:id/accept', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const result = acceptIncomingCallById(req.params.id, user.id);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: 'Call is no longer ringing.' });
      return;
    }
    res.json({ ok: true, alreadyActive: Boolean(result.alreadyActive) });
  });

  router.post('/calls/:id/decline', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const declined = rejectIncomingCallById(req.params.id, user.id);
    res.json({ ok: true, declined });
  });

  const getStoryConnectedIds = (uid: string): Set<string> => {
    const connected = new Set<string>();
    const fRows = db
      .prepare(
        `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS peer_id
         FROM friendships WHERE user_a = ? OR user_b = ?`
      )
      .all(uid, uid, uid) as Array<{ peer_id: string }>;
    for (const r of fRows) {
      if (r.peer_id && r.peer_id !== uid && !isBlockedBetween(uid, r.peer_id)) {
        connected.add(r.peer_id);
      }
    }
    const sRows = db
      .prepare(
        `SELECT contact_user_id AS peer_id FROM synced_contacts WHERE owner_id = ?
         UNION
         SELECT owner_id AS peer_id FROM synced_contacts WHERE contact_user_id = ?`
      )
      .all(uid, uid) as Array<{ peer_id: string }>;
    for (const r of sRows) {
      if (r.peer_id && r.peer_id !== uid && !isBlockedBetween(uid, r.peer_id)) {
        connected.add(r.peer_id);
      }
    }
    return connected;
  };

  router.get('/stories', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const now = Date.now();
    const directIds = getStoryConnectedIds(user.id);
    const fofIds = new Set<string>();
    for (const fid of directIds) {
      for (const candidate of getStoryConnectedIds(fid)) {
        if (
          candidate !== user.id &&
          !directIds.has(candidate) &&
          !isBlockedBetween(user.id, candidate)
        ) {
          fofIds.add(candidate);
        }
      }
    }

    const rows = db
      .prepare(
        `SELECT s.id AS story_id, s.author_id, s.media_type, s.text_content, s.bg_style,
                s.media_upload_id, s.duration_sec, s.visibility,
                s.created_at AS story_created_at, s.expires_at,
                u.*,
                EXISTS(SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = ?) AS viewed_by_me,
                (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id != s.author_id) AS view_count
         FROM stories s
         INNER JOIN users u ON u.id = s.author_id
         WHERE s.expires_at > ?
         ORDER BY s.created_at ASC`
      )
      .all(user.id, now) as unknown as Array<
      {
        story_id: string;
        author_id: string;
        media_type: 'text' | 'image' | 'video';
        text_content: string;
        bg_style: string;
        media_upload_id: string | null;
        duration_sec: number;
        visibility: 'friends' | 'friends_of_friends';
        story_created_at: number;
        expires_at: number;
        viewed_by_me: number;
        view_count: number;
      } & UserRow
    >;

    const myStories: Array<Record<string, unknown>> = [];
    const groupMap = new Map<
      string,
      {
        author: Record<string, unknown>;
        relation: 'friend' | 'friend_of_friend';
        hasUnviewed: boolean;
        latestCreatedAt: number;
        stories: Array<Record<string, unknown>>;
      }
    >();

    for (const r of rows) {
      const isSelf = r.author_id === user.id;
      const isDirect = directIds.has(r.author_id);
      const isFof = fofIds.has(r.author_id);

      if (!isSelf) {
        if (isBlockedBetween(user.id, r.author_id)) continue;
        if (!isDirect && !(r.visibility === 'friends_of_friends' && isFof)) continue;
      }

      const item = {
        id: r.story_id,
        authorId: r.author_id,
        mediaType: r.media_type,
        textContent: r.text_content,
        bgStyle: r.bg_style,
        mediaUrl: r.media_upload_id ? `/api/uploads/${r.media_upload_id}` : null,
        durationSec: r.duration_sec,
        visibility: r.visibility,
        createdAt: r.story_created_at,
        expiresAt: r.expires_at,
        viewedByMe: Boolean(r.viewed_by_me),
        viewCount: isSelf ? Number(r.view_count) || 0 : undefined,
      };

      if (isSelf) {
        myStories.push(item);
      } else {
        let grp = groupMap.get(r.author_id);
        if (!grp) {
          grp = {
            author: {
              ...getPublicUserView(r, isDirect),
              lastSeenAt: r.show_online_status ? r.last_seen_at : 0,
              online: r.show_online_status ? isUserOnline(r.author_id) : false,
              showOnlineStatus: Boolean(r.show_online_status),
            },
            relation: isDirect ? 'friend' : 'friend_of_friend',
            hasUnviewed: false,
            latestCreatedAt: r.story_created_at,
            stories: [],
          };
          groupMap.set(r.author_id, grp);
        }
        if (!item.viewedByMe) grp.hasUnviewed = true;
        if (r.story_created_at > grp.latestCreatedAt) grp.latestCreatedAt = r.story_created_at;
        grp.stories.push(item);
      }
    }

    const groups = Array.from(groupMap.values()).sort((a, b) => {
      if (a.hasUnviewed !== b.hasUnviewed) return a.hasUnviewed ? -1 : 1;
      return b.latestCreatedAt - a.latestCreatedAt;
    });

    res.json({ myStories, groups });
  });

  router.post('/stories', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    if (!checkRateLimit(`story-create:${user.id}`, 30, 60 * 60_000)) {
      res.status(429).json({ error: 'Story post rate limit reached.' });
      return;
    }

    const mediaType =
      req.body?.mediaType === 'image' || req.body?.mediaType === 'video'
        ? req.body.mediaType
        : 'text';
    const visibility =
      req.body?.visibility === 'friends_of_friends' ? 'friends_of_friends' : 'friends';
    const textContent =
      typeof req.body?.textContent === 'string' ? req.body.textContent.trim().slice(0, 500) : '';
    const rawBg = typeof req.body?.bgStyle === 'string' ? req.body.bgStyle.trim() : '#1D8BF1';
    const bgStyle = /^#[0-9a-fA-F]{6}$/.test(rawBg) ? rawBg : '#1D8BF1';
    const uploadId =
      typeof req.body?.uploadId === 'string' && /^[0-9a-f-]{36}$/i.test(req.body.uploadId)
        ? req.body.uploadId
        : null;
    const durationSec = Math.max(0, Math.min(30, Math.round(Number(req.body?.durationSec) || 0)));

    if (mediaType === 'text' && !textContent) {
      res.status(400).json({ error: 'Please write something for your text story.' });
      return;
    }

    if ((mediaType === 'image' || mediaType === 'video') && !uploadId) {
      res.status(400).json({ error: 'Story photo or video upload is required.' });
      return;
    }

    if (mediaType === 'video' && Number(req.body?.durationSec) > 30.9) {
      res.status(400).json({ error: 'Story video cannot be longer than 30 seconds.' });
      return;
    }

    if (uploadId) {
      const up = db
        .prepare('SELECT id FROM uploads WHERE id = ? AND owner_id = ?')
        .get(uploadId, user.id);
      if (!up) {
        res.status(400).json({ error: 'Uploaded story media not found.' });
        return;
      }
    }

    const now = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;
    const storyId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO stories (id, author_id, media_type, text_content, bg_style, media_upload_id, duration_sec, visibility, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      storyId,
      user.id,
      mediaType,
      textContent,
      bgStyle,
      uploadId,
      mediaType === 'video' ? durationSec || 30 : 5,
      visibility,
      now,
      expiresAt
    );

    const directIds = getStoryConnectedIds(user.id);
    const notifyIds = new Set<string>(directIds);
    if (visibility === 'friends_of_friends') {
      for (const fid of directIds) {
        for (const fof of getStoryConnectedIds(fid)) {
          if (fof !== user.id && !isBlockedBetween(user.id, fof)) {
            notifyIds.add(fof);
          }
        }
      }
    }
    for (const targetId of notifyIds) {
      sendToUser(targetId, { type: 'stories:refresh' });
    }

    res.json({
      story: {
        id: storyId,
        authorId: user.id,
        mediaType,
        textContent,
        bgStyle,
        mediaUrl: uploadId ? `/api/uploads/${uploadId}` : null,
        durationSec: mediaType === 'video' ? durationSec || 30 : 5,
        visibility,
        createdAt: now,
        expiresAt,
        viewedByMe: true,
        viewCount: 0,
      },
    });
  });

  router.post('/stories/:id/view', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const story = db
      .prepare('SELECT id, author_id, visibility, expires_at FROM stories WHERE id = ?')
      .get(req.params.id) as
      | { id: string; author_id: string; visibility: string; expires_at: number }
      | undefined;

    if (!story || story.expires_at <= Date.now()) {
      res.status(404).json({ error: 'Story not found.' });
      return;
    }

    if (story.author_id !== user.id) {
      if (isBlockedBetween(user.id, story.author_id)) {
        res.status(403).json({ error: 'Not allowed.' });
        return;
      }
      const directIds = getStoryConnectedIds(user.id);
      let allowed = directIds.has(story.author_id);
      if (!allowed && story.visibility === 'friends_of_friends') {
        for (const fid of directIds) {
          if (getStoryConnectedIds(fid).has(story.author_id)) {
            allowed = true;
            break;
          }
        }
      }
      if (!allowed) {
        res.status(403).json({ error: 'Not allowed to view this story.' });
        return;
      }
    }

    db.prepare(
      `INSERT OR IGNORE INTO story_views (story_id, viewer_id, viewed_at) VALUES (?, ?, ?)`
    ).run(story.id, user.id, Date.now());
    res.json({ ok: true });
  });

  router.delete('/stories/:id', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const story = db
      .prepare('SELECT id, media_upload_id FROM stories WHERE id = ? AND author_id = ?')
      .get(req.params.id, user.id) as { id: string; media_upload_id: string | null } | undefined;

    if (!story) {
      res.status(404).json({ error: 'Story not found.' });
      return;
    }

    db.prepare('DELETE FROM stories WHERE id = ?').run(story.id);
    if (story.media_upload_id) {
      const up = db
        .prepare('SELECT file_name FROM uploads WHERE id = ? AND owner_id = ?')
        .get(story.media_upload_id, user.id) as { file_name: string } | undefined;
      if (up) {
        const safePath = resolveSafeUploadPath(up.file_name);
        if (safePath && fs.existsSync(safePath)) fs.unlinkSync(safePath);
        db.prepare('DELETE FROM uploads WHERE id = ?').run(story.media_upload_id);
      }
    }
    res.json({ ok: true });
  });

  return router;
}
