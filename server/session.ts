import { db, type UserRow } from './db.ts';
import {
  SESSION_TTL_MS,
  createSignedSessionToken,
  hashWithServerSecret,
  verifySignedSessionToken,
} from './security.ts';

const SLIDING_RENEW_THRESHOLD_MS = SESSION_TTL_MS - 60 * 60 * 1000;

export function createPersistentSession(
  user: UserRow,
  userAgent = ''
): { rawToken: string; expiresAt: number } {
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const rawToken = createSignedSessionToken(user, SESSION_TTL_MS);
  const tokenHash = hashWithServerSecret(rawToken);

  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, expires_at, created_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tokenHash, user.id, expiresAt, now, userAgent.slice(0, 200));

  return { rawToken, expiresAt };
}

export function resolveOrRestoreSessionUser(
  rawToken: string | null | undefined,
  userAgent = ''
): { user: UserRow; expiresAt: number } | null {
  if (!rawToken || typeof rawToken !== 'string') return null;
  const trimmed = rawToken.trim();
  if (!trimmed) return null;

  const now = Date.now();
  const tokenHash = hashWithServerSecret(trimmed);

  const revoked = db
    .prepare('SELECT 1 FROM revoked_tokens WHERE token_hash = ?')
    .get(tokenHash);
  if (revoked) return null;

  const existing = db
    .prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?')
    .get(tokenHash) as { user_id: string; expires_at: number } | undefined;

  if (existing) {
    if (existing.expires_at <= now) {
      return null;
    }
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.user_id) as
      | UserRow
      | undefined;
    if (!user) return null;

    let expiresAt = existing.expires_at;
    if (existing.expires_at < now + SLIDING_RENEW_THRESHOLD_MS) {
      expiresAt = now + SESSION_TTL_MS;
      db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(
        expiresAt,
        tokenHash
      );
    }
    return { user, expiresAt };
  }

  // Fallback for signed tokens when session store was reset across container restarts
  const payload = verifySignedSessionToken(trimmed);
  if (!payload) return null;

  const deleted = db
    .prepare('SELECT 1 FROM deleted_users WHERE user_id = ?')
    .get(payload.uid);
  if (deleted) return null;

  let user = db
    .prepare('SELECT * FROM users WHERE id = ? OR phone_e164 = ? LIMIT 1')
    .get(payload.uid, payload.ph) as UserRow | undefined;

  if (!user) {
    db.prepare(
      `INSERT OR IGNORE INTO users (id, phone_e164, country_iso, country_code, display_name, language, qr_token, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      payload.uid,
      payload.ph,
      payload.ci,
      payload.cc,
      payload.dn,
      payload.lg,
      payload.qt,
      payload.iat,
      now
    );
    user = db
      .prepare('SELECT * FROM users WHERE id = ? OR phone_e164 = ? LIMIT 1')
      .get(payload.uid, payload.ph) as UserRow | undefined;
  }

  if (!user) return null;

  const expiresAt = now + SESSION_TTL_MS;
  db.prepare(
    `INSERT OR IGNORE INTO sessions (token_hash, user_id, expires_at, created_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  ).run(tokenHash, user.id, expiresAt, now, userAgent.slice(0, 200));

  return { user, expiresAt };
}

export function revokeSessionToken(rawToken: string | null | undefined): void {
  if (!rawToken || typeof rawToken !== 'string') return;
  const trimmed = rawToken.trim();
  if (!trimmed) return;
  const now = Date.now();
  const tokenHash = hashWithServerSecret(trimmed);
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  db.prepare(
    `INSERT OR REPLACE INTO revoked_tokens (token_hash, expires_at, revoked_at)
     VALUES (?, ?, ?)`
  ).run(tokenHash, now + SESSION_TTL_MS, now);
}

export function revokeAllSessionsForDeletedUser(userId: string): void {
  const now = Date.now();
  const rows = db
    .prepare('SELECT token_hash, expires_at FROM sessions WHERE user_id = ?')
    .all(userId) as Array<{ token_hash: string; expires_at: number }>;

  const insertRevoked = db.prepare(
    `INSERT OR REPLACE INTO revoked_tokens (token_hash, expires_at, revoked_at)
     VALUES (?, ?, ?)`
  );
  for (const r of rows) {
    insertRevoked.run(r.token_hash, Math.max(r.expires_at, now + SESSION_TTL_MS), now);
  }
  db.prepare(
    `INSERT OR REPLACE INTO deleted_users (user_id, deleted_at) VALUES (?, ?)`
  ).run(userId, now);
}
