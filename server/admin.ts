import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response, Router } from 'express';
import express from 'express';
import { compileDirectAndroidApk, detectApkToolchain } from './apkBuilder.ts';

const execFileAsync = promisify(execFile);
import { db } from './db.ts';
import {
  checkRateLimit,
  generateSessionToken,
  getClientIp,
  hashPin,
  hashWithServerSecret,
  verifyPin,
  verifySameOriginIfCookie,
} from './security.ts';

const ROOT_DIR = process.cwd();
const BUILDS_DIR = path.resolve(ROOT_DIR, 'data', 'builds');
const PREBUILT_DIR = path.resolve(ROOT_DIR, 'server', 'prebuilt');
const PREBUILT_APK_PATH = path.resolve(PREBUILT_DIR, 'EASY_CALL_ANDROID.apk');
fs.mkdirSync(BUILDS_DIR, { recursive: true });
fs.mkdirSync(PREBUILT_DIR, { recursive: true });

interface AdminRequest extends Request {
  usedCookieAuth?: boolean;
}

function setAdminCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  const maxAgeSec = Math.floor(maxAgeMs / 1000);
  const parts = [
    `easycall_admin_sid=${encodeURIComponent(token)}`,
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

function clearAdminCookie(req: Request, res: Response) {
  const isHttps =
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https' ||
    (process.env.APP_URL || '').startsWith('https://');
  const parts = [
    'easycall_admin_sid=',
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

function getAdminTokenFromReq(req: Request): { token: string | null; usedCookie: boolean } {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return { token: authHeader.slice(7).trim(), usedCookie: false };
  }
  if (req.cookies && typeof req.cookies.easycall_admin_sid === 'string' && req.cookies.easycall_admin_sid) {
    return { token: req.cookies.easycall_admin_sid, usedCookie: true };
  }
  return { token: null, usedCookie: false };
}

function isAdminTokenValid(req: Request): { valid: boolean; usedCookie: boolean } {
  const { token, usedCookie } = getAdminTokenFromReq(req);
  if (!token) return { valid: false, usedCookie };
  const tokenHash = hashWithServerSecret(token);
  const row = db
    .prepare('SELECT expires_at FROM admin_sessions WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, Date.now()) as { expires_at: number } | undefined;
  return { valid: Boolean(row), usedCookie };
}

function requireAdmin(req: AdminRequest, res: Response, next: NextFunction) {
  const { valid, usedCookie } = isAdminTokenValid(req);
  if (!valid) {
    res.status(401).json({ error: 'Admin authentication required.' });
    return;
  }
  if (
    usedCookie &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    !verifySameOriginIfCookie(req, true)
  ) {
    res.status(403).json({ error: 'Cross-origin admin mutation rejected.' });
    return;
  }
  req.usedCookieAuth = usedCookie;
  next();
}

function getClaimedAdminHash(): string | null {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'admin_passcode_hash'`)
    .get() as { value: string } | undefined;
  return row ? row.value : null;
}

function getClaimedAdminNumberHash(): string | null {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'admin_number_hash'`)
    .get() as { value: string } | undefined;
  return row ? row.value : null;
}

function normalizeDigits(val: string): string {
  return val.replace(/\D/g, '');
}

function safeEqualUtf8(aStr: string, bStr: string): boolean {
  const a = Buffer.from(aStr, 'utf8');
  const b = Buffer.from(bStr, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function matchesAdminNumber(rawInput: string): boolean {
  const digits = normalizeDigits(rawInput);
  if (!digits) return false;

  const envNumber = process.env.ADMIN_NUMBER?.trim();
  if (envNumber) {
    const envDigits = normalizeDigits(envNumber);
    if (!envDigits) return true;
    return safeEqualUtf8(digits, envDigits) || (digits.length > envDigits.length && digits.endsWith(envDigits));
  }

  const claimedNumberHash = getClaimedAdminNumberHash();
  if (!claimedNumberHash) {
    return true;
  }

  if (verifyPin(digits, claimedNumberHash)) return true;
  // Also allow matching E.164 phone numbers whose trailing local digits match admin_number
  for (const len of [7, 8, 9, 10, 11, 12]) {
    if (digits.length > len && verifyPin(digits.slice(-len), claimedNumberHash)) {
      return true;
    }
  }
  return false;
}

function getAuthenticatedUserPhone(req: Request): string | null {
  const headerToken = req.headers['x-user-token'];
  const cookieToken = req.cookies?.easycall_sid;
  const rawToken =
    typeof headerToken === 'string' && headerToken
      ? headerToken.trim()
      : typeof cookieToken === 'string' && cookieToken
        ? cookieToken
        : null;
  if (!rawToken) return null;

  const row = db
    .prepare(
      `SELECT u.phone_e164
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(hashWithServerSecret(rawToken), Date.now()) as { phone_e164: string } | undefined;

  return row ? row.phone_e164 : null;
}

function createAdminSession(req: Request, res: Response): string {
  const rawToken = generateSessionToken();
  const tokenHash = hashWithServerSecret(rawToken);
  const now = Date.now();
  const maxAgeMs = 12 * 60 * 60 * 1000;
  db.prepare(
    `INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)`
  ).run(tokenHash, now + maxAgeMs, now);
  setAdminCookie(req, res, rawToken, maxAgeMs);
  return rawToken;
}

export function createAdminRouter(): Router {
  const router = express.Router();

  router.get('/status', (req, res) => {
    const envPass = process.env.ADMIN_PASSCODE?.trim();
    const envNumber = process.env.ADMIN_NUMBER?.trim();
    const claimedHash = getClaimedAdminHash();
    const claimedNumberHash = getClaimedAdminNumberHash();
    const { valid } = isAdminTokenValid(req);
    const requiresAdminNumber = Boolean(envNumber || claimedNumberHash);

    let isAdminUser = false;
    if (requiresAdminNumber) {
      const userPhone = getAuthenticatedUserPhone(req);
      if (userPhone && matchesAdminNumber(userPhone)) {
        isAdminUser = true;
      }
    }

    res.json({
      authenticated: valid,
      envConfigured: Boolean(envPass),
      setupRequired: !envPass && !claimedHash,
      requiresAdminNumber,
      isAdminUser,
    });
  });

  router.post('/claim', (req, res) => {
    const envPass = process.env.ADMIN_PASSCODE?.trim();
    if (envPass) {
      res.status(409).json({ error: 'Admin passcode is already configured via environment.' });
      return;
    }

    const adminNumber =
      typeof req.body?.adminNumber === 'string' ? normalizeDigits(req.body.adminNumber) : '';
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';

    if (adminNumber && (adminNumber.length < 5 || adminNumber.length > 20)) {
      res.status(400).json({ error: 'Admin number must be 5 to 20 digits.' });
      return;
    }
    if (passcode.length < 6 || passcode.length > 64) {
      res.status(400).json({ error: 'Admin passcode must be 6 to 64 characters.' });
      return;
    }

    const hash = hashPin(passcode);
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO app_settings (key, value, updated_at)
         VALUES ('admin_passcode_hash', ?, ?)`
      )
      .run(hash, Date.now());

    if (result.changes === 0) {
      res.status(409).json({ error: 'Admin access has already been claimed.' });
      return;
    }

    if (adminNumber) {
      db.prepare(
        `INSERT OR REPLACE INTO app_settings (key, value, updated_at)
         VALUES ('admin_number_hash', ?, ?)`
      ).run(hashPin(adminNumber), Date.now());
    }

    const token = createAdminSession(req, res);
    res.json({ ok: true, token });
  });

  router.post('/login', (req, res) => {
    const ip = getClientIp(req);
    if (!checkRateLimit(`admin-login:${ip}`, 10, 15 * 60_000)) {
      res.status(429).json({ error: 'Too many admin sign-in attempts. Wait 15 minutes.' });
      return;
    }

    const adminNumber = typeof req.body?.adminNumber === 'string' ? req.body.adminNumber.trim() : '';
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode.trim() : '';
    if (!passcode) {
      res.status(400).json({ error: 'Admin password is required.' });
      return;
    }

    const requiresAdminNumber = Boolean(
      process.env.ADMIN_NUMBER?.trim() || getClaimedAdminNumberHash()
    );
    if (requiresAdminNumber && !matchesAdminNumber(adminNumber)) {
      res.status(401).json({ error: 'Incorrect admin number or password.' });
      return;
    }

    const envPass = process.env.ADMIN_PASSCODE?.trim();
    let ok = false;

    if (envPass) {
      ok = safeEqualUtf8(passcode, envPass);
    } else {
      const claimedHash = getClaimedAdminHash();
      if (claimedHash) {
        ok = verifyPin(passcode, claimedHash);
      }
    }

    if (!ok) {
      res.status(401).json({ error: 'Incorrect admin number or password.' });
      return;
    }

    const token = createAdminSession(req, res);
    res.json({ ok: true, token });
  });

  router.post('/logout', (req, res) => {
    const { token } = getAdminTokenFromReq(req);
    if (token) {
      db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(
        hashWithServerSecret(token)
      );
    }
    clearAdminCookie(req, res);
    res.json({ ok: true });
  });

  router.get('/android-builder/info', requireAdmin, async (req, res) => {
    const toolchain = await detectApkToolchain();
    const apkPath = path.resolve(BUILDS_DIR, 'EASY_CALL_ANDROID.apk');
    const activeApkPath = fs.existsSync(apkPath)
      ? apkPath
      : fs.existsSync(PREBUILT_APK_PATH)
        ? PREBUILT_APK_PATH
        : null;

    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const inferredUrl = host ? `${proto}://${host}` : process.env.APP_URL || '';

    let savedMeta: Record<string, unknown> = {
      appName: 'EASY CALL',
      applicationId: 'app.easycall.global',
      versionName: '1.0.0',
      versionCode: 1,
      serverUrl: process.env.APP_URL || inferredUrl,
    };
    const metaRow = db
      .prepare(`SELECT value FROM app_settings WHERE key = 'android_builder_meta'`)
      .get() as { value: string } | undefined;
    if (metaRow) {
      try {
        savedMeta = JSON.parse(metaRow.value);
      } catch {
        // Keep defaults
      }
    }

    res.json({
      nativeApkCompilerAvailable: toolchain.available,
      environmentChecks: {
        hasJava: toolchain.hasJava,
        hasAndroidSdk: Boolean(toolchain.sdkRoot && toolchain.androidJarPath),
        hasGradle: toolchain.available,
      },
      config: savedMeta,
      artifacts: {
        apkReady: Boolean(activeApkPath),
        apkSizeBytes: activeApkPath ? fs.statSync(activeApkPath).size : 0,
      },
    });
  });

  router.post('/android-builder/build', requireAdmin, async (req, res) => {
    const body = req.body || {};
    const appName =
      typeof body.appName === 'string' && body.appName.trim().length > 0
        ? body.appName.trim().slice(0, 40)
        : 'EASY CALL';
    const applicationId =
      typeof body.applicationId === 'string' ? body.applicationId.trim() : 'app.easycall.global';
    const versionName =
      typeof body.versionName === 'string' ? body.versionName.trim() : '1.0.0';
    const versionCode = Number.isInteger(Number(body.versionCode))
      ? Math.max(1, Math.min(99999, Number(body.versionCode)))
      : 1;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host || '';
    const fallbackUrl = process.env.APP_URL || (host ? `${proto}://${host}` : '');
    const serverUrl =
      typeof body.serverUrl === 'string' && body.serverUrl.trim()
        ? body.serverUrl.trim()
        : fallbackUrl;

    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(applicationId)) {
      res.status(400).json({ error: 'Package ID must follow format like app.easycall.global' });
      return;
    }
    if (!/^\d+\.\d+\.\d+$/.test(versionName)) {
      res.status(400).json({ error: 'Version Name must follow format like 1.0.0' });
      return;
    }
    if (!serverUrl || !/^https?:\/\/[^\s"'`]+$/i.test(serverUrl)) {
      res.status(400).json({ error: 'Server URL must start with http:// or https://' });
      return;
    }

    const apkOutPath = path.resolve(BUILDS_DIR, 'EASY_CALL_ANDROID.apk');
    const toolchain = await detectApkToolchain();

    if (!toolchain.available) {
      if (fs.existsSync(PREBUILT_APK_PATH)) {
        fs.copyFileSync(PREBUILT_APK_PATH, apkOutPath);
        const sizeBytes = fs.statSync(apkOutPath).size;
        res.json({
          ok: true,
          compiledApk: true,
          apkSizeBytes: sizeBytes,
          config: { appName, applicationId, versionName, versionCode, serverUrl, builtAt: Date.now() },
        });
        return;
      }
      res.status(503).json({
        error: 'Android SDK build tools are unavailable in this runtime.',
      });
      return;
    }

    try {
      await execFileAsync('npm', ['run', 'build'], { cwd: ROOT_DIR, timeout: 120_000 });
      const { sizeBytes } = await compileDirectAndroidApk(
        { appName, applicationId, versionName, versionCode, serverUrl },
        ROOT_DIR,
        BUILDS_DIR,
        apkOutPath
      );

      fs.copyFileSync(apkOutPath, PREBUILT_APK_PATH);

      const meta = {
        appName,
        applicationId,
        versionName,
        versionCode,
        serverUrl,
        builtAt: Date.now(),
      };
      db.prepare(
        `INSERT INTO app_settings (key, value, updated_at)
         VALUES ('android_builder_meta', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      ).run(JSON.stringify(meta), Date.now());

      res.json({
        ok: true,
        compiledApk: true,
        apkSizeBytes: sizeBytes,
        config: meta,
      });
    } catch (err) {
      res.status(500).json({
        error: `APK build failed: ${err instanceof Error ? err.message : 'Unknown compiler error'}`,
      });
    }
  });

  router.get('/android-builder/check-url', requireAdmin, async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim().replace(/\/+$/, '') : '';
    if (!rawUrl || !/^https?:\/\/[^\s"'`]+$/i.test(rawUrl)) {
      res.status(400).json({ reachable: false, status: 0, error: 'Invalid URL' });
      return;
    }
    try {
      const resp = await fetch(`${rawUrl}/api/geo/detect`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });
      const ct = resp.headers.get('content-type') || '';
      const okJson = resp.status === 200 && ct.includes('application/json');
      res.json({
        reachable: okJson,
        status: resp.status,
      });
    } catch {
      res.json({ reachable: false, status: 0 });
    }
  });

  router.get('/android-builder/download', requireAdmin, (_req, res) => {
    const fileName = 'EASY_CALL_ANDROID.apk';
    const primaryPath = path.resolve(BUILDS_DIR, fileName);
    const filePath = fs.existsSync(primaryPath)
      ? primaryPath
      : fs.existsSync(PREBUILT_APK_PATH)
        ? PREBUILT_APK_PATH
        : null;

    if (!filePath) {
      res.status(404).json({ error: 'Android APK has not been built yet.' });
      return;
    }

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(filePath).pipe(res);
  });

  return router;
}
