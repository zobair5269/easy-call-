import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOAD_DIR = path.resolve(DATA_DIR, 'uploads');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const DB_PATH = path.resolve(DATA_DIR, 'easycall.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    phone_e164 TEXT NOT NULL UNIQUE,
    country_iso TEXT NOT NULL DEFAULT 'US',
    country_code TEXT NOT NULL DEFAULT '+1',
    display_name TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    avatar_id TEXT,
    language TEXT NOT NULL DEFAULT 'en',
    qr_token TEXT NOT NULL UNIQUE,
    discoverable_by_phone INTEGER NOT NULL DEFAULT 1,
    discoverable_by_name INTEGER NOT NULL DEFAULT 1,
    show_online_status INTEGER NOT NULL DEFAULT 1,
    data_saver INTEGER NOT NULL DEFAULT 0,
    recovery_pin_hash TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS otp_challenges (
    id TEXT PRIMARY KEY,
    phone_e164 TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(from_user_id, to_user_id),
    FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS friendships (
    user_a TEXT NOT NULL,
    user_b TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_a, user_b),
    FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS blocks (
    blocker_id TEXT NOT NULL,
    blocked_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id),
    FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL,
    reported_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (reported_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS call_records (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL,
    callee_id TEXT NOT NULL,
    call_type TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    answered_at INTEGER,
    ended_at INTEGER,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    hidden_for_caller INTEGER NOT NULL DEFAULT 0,
    hidden_for_callee INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (caller_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (callee_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    image_id TEXT,
    status TEXT NOT NULL DEFAULT 'sent',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    related_user_id TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS uploads (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'avatar',
    created_at INTEGER NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS device_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    token TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, token),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_challenges(phone_e164);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_fr_to ON friend_requests(to_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_fr_from ON friend_requests(from_user_id, status);
  CREATE INDEX IF NOT EXISTS idx_calls_caller ON call_records(caller_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_calls_callee ON call_records(callee_id, started_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_pair ON messages(sender_id, receiver_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);
`);

export interface UserRow {
  id: string;
  phone_e164: string;
  country_iso: string;
  country_code: string;
  display_name: string;
  bio: string;
  avatar_id: string | null;
  language: string;
  qr_token: string;
  discoverable_by_phone: number;
  discoverable_by_name: number;
  show_online_status: number;
  data_saver: number;
  recovery_pin_hash: string | null;
  created_at: number;
  last_seen_at: number;
}

export function normalizePair(id1: string, id2: string): [string, string] {
  return id1 < id2 ? [id1, id2] : [id2, id1];
}

export function areFriends(userA: string, userB: string): boolean {
  const [a, b] = normalizePair(userA, userB);
  const row = db
    .prepare('SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?')
    .get(a, b);
  return Boolean(row);
}

export function isBlockedBetween(userA: string, userB: string): boolean {
  const row = db
    .prepare(
      'SELECT 1 FROM blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
    )
    .get(userA, userB, userB, userA);
  return Boolean(row);
}

export function getPublicUserView(row: UserRow, includePhone = false) {
  return {
    id: row.id,
    phoneE164: includePhone ? row.phone_e164 : undefined,
    countryIso: row.country_iso,
    countryCode: row.country_code,
    displayName: row.display_name || row.phone_e164,
    bio: row.bio,
    avatarUrl: row.avatar_id ? `/api/uploads/${row.avatar_id}` : null,
    qrToken: row.qr_token,
    lastSeenAt: row.last_seen_at,
  };
}

export function getFullSelfView(row: UserRow) {
  return {
    id: row.id,
    phoneE164: row.phone_e164,
    countryIso: row.country_iso,
    countryCode: row.country_code,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_id ? `/api/uploads/${row.avatar_id}` : null,
    language: row.language,
    qrToken: row.qr_token,
    discoverableByPhone: Boolean(row.discoverable_by_phone),
    discoverableByName: Boolean(row.discoverable_by_name),
    showOnlineStatus: Boolean(row.show_online_status),
    dataSaver: Boolean(row.data_saver),
    hasRecoveryPin: Boolean(row.recovery_pin_hash),
    createdAt: row.created_at,
  };
}
