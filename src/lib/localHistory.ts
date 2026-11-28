import type { CallRecordItem, ChatMessage, HomeFeedItem, PublicUser, SelfUser } from '../types/app';
import {
  clearNativeHistorySnapshot,
  getNativeHistorySnapshot,
  saveNativeHistorySnapshot,
} from './nativeBridge';

const STORAGE_PREFIX = 'easycall_history_v1:';
const SELF_PROFILE_KEY = 'easycall_self_profile_v1';

export function loadCachedSelfProfile(): SelfUser | null {
  try {
    const raw = window.localStorage.getItem(SELF_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SelfUser>;
    if (typeof parsed?.id === 'string' && typeof parsed?.phoneE164 === 'string' && parsed.id && parsed.phoneE164) {
      return parsed as SelfUser;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveCachedSelfProfile(user: SelfUser): void {
  try {
    window.localStorage.setItem(SELF_PROFILE_KEY, JSON.stringify(user));
  } catch {
    // Ignore storage errors
  }
}

export function clearCachedSelfProfile(): void {
  try {
    window.localStorage.removeItem(SELF_PROFILE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export interface StoredThread {
  peerId: string;
  peerPhone?: string;
  messages: ChatMessage[];
}

export interface LocalHistorySnapshot {
  selfUserId: string;
  phoneE164: string;
  homeFeed: HomeFeedItem[];
  friendsList: PublicUser[];
  calls: CallRecordItem[];
  threads: Record<string, StoredThread>;
  updatedAt: number;
}

function emptySnapshot(phoneE164: string, selfUserId = ''): LocalHistorySnapshot {
  return {
    selfUserId,
    phoneE164,
    homeFeed: [],
    friendsList: [],
    calls: [],
    threads: {},
    updatedAt: Date.now(),
  };
}

export function loadLocalHistory(phoneE164: string): LocalHistorySnapshot {
  if (!phoneE164) return emptySnapshot('');
  const key = STORAGE_PREFIX + phoneE164;
  let raw = '';
  try {
    raw = window.localStorage.getItem(key) || '';
  } catch {
    raw = '';
  }
  if (!raw) {
    raw = getNativeHistorySnapshot(phoneE164);
  }
  if (!raw) return emptySnapshot(phoneE164);

  try {
    const parsed = JSON.parse(raw) as Partial<LocalHistorySnapshot>;
    return {
      selfUserId: typeof parsed.selfUserId === 'string' ? parsed.selfUserId : '',
      phoneE164,
      homeFeed: Array.isArray(parsed.homeFeed) ? parsed.homeFeed : [],
      friendsList: Array.isArray(parsed.friendsList) ? parsed.friendsList : [],
      calls: Array.isArray(parsed.calls) ? parsed.calls : [],
      threads:
        parsed.threads && typeof parsed.threads === 'object' ? parsed.threads : {},
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return emptySnapshot(phoneE164);
  }
}

export function saveLocalHistory(snapshot: LocalHistorySnapshot): void {
  if (!snapshot.phoneE164) return;
  const trimmed: LocalHistorySnapshot = {
    ...snapshot,
    homeFeed: snapshot.homeFeed.slice(0, 200),
    friendsList: snapshot.friendsList.slice(0, 300),
    calls: snapshot.calls.slice(0, 200),
    updatedAt: Date.now(),
  };
  try {
    const json = JSON.stringify(trimmed);
    try {
      window.localStorage.setItem(STORAGE_PREFIX + snapshot.phoneE164, json);
    } catch {
      // Ignore quota errors
    }
    saveNativeHistorySnapshot(snapshot.phoneE164, json);
  } catch {
    // Ignore serialization errors
  }
}

export function clearLocalHistory(phoneE164: string): void {
  if (!phoneE164) return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + phoneE164);
  } catch {
    // Ignore storage errors
  }
  clearNativeHistorySnapshot(phoneE164);
}

export function migrateSelfUserId(
  snap: LocalHistorySnapshot,
  newSelfUserId: string
): LocalHistorySnapshot {
  if (!snap.selfUserId || !newSelfUserId || snap.selfUserId === newSelfUserId) {
    return snap;
  }
  const oldId = snap.selfUserId;
  const nextThreads: Record<string, StoredThread> = {};
  for (const [key, thread] of Object.entries(snap.threads)) {
    nextThreads[key] = {
      ...thread,
      messages: thread.messages.map((m) => ({
        ...m,
        senderId: m.senderId === oldId ? newSelfUserId : m.senderId,
        receiverId: m.receiverId === oldId ? newSelfUserId : m.receiverId,
      })),
    };
  }
  const updated: LocalHistorySnapshot = {
    ...snap,
    selfUserId: newSelfUserId,
    threads: nextThreads,
  };
  saveLocalHistory(updated);
  return updated;
}

export function mergeFriends(server: PublicUser[], local: PublicUser[]): PublicUser[] {
  const byKey = new Map<string, PublicUser>();
  for (const l of local) {
    const key = l.phoneE164 || l.id;
    if (key) byKey.set(key, l);
  }
  for (const s of server) {
    const key = s.phoneE164 || s.id;
    if (key) byKey.set(key, s);
  }
  return Array.from(byKey.values());
}

export function mergeCalls(server: CallRecordItem[], local: CallRecordItem[]): CallRecordItem[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const result: CallRecordItem[] = [];

  for (const c of server) {
    seenIds.add(c.id);
    seenKeys.add(`${c.peerId}:${c.startedAt}`);
    result.push(c);
  }
  for (const c of local) {
    if (seenIds.has(c.id) || seenKeys.has(`${c.peerId}:${c.startedAt}`)) continue;
    seenIds.add(c.id);
    seenKeys.add(`${c.peerId}:${c.startedAt}`);
    result.push(c);
  }
  result.sort((a, b) => Number(b.startedAt) - Number(a.startedAt));
  return result.slice(0, 200);
}

export function mergeHomeFeed(server: HomeFeedItem[], local: HomeFeedItem[]): HomeFeedItem[] {
  const byKey = new Map<string, HomeFeedItem>();
  for (const l of local) {
    const key = l.peer.phoneE164 || l.peer.id;
    if (key) byKey.set(key, l);
  }
  for (const s of server) {
    const key = s.peer.phoneE164 || s.peer.id;
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, s);
    } else {
      byKey.set(key, {
        ...s,
        lastCall: s.lastCall || prev.lastCall || null,
        lastMessage: s.lastMessage || prev.lastMessage || null,
        lastActivityAt: Math.max(Number(s.lastActivityAt) || 0, Number(prev.lastActivityAt) || 0),
      });
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => Number(b.lastActivityAt) - Number(a.lastActivityAt)
  );
}

export function mergeThreadMessages(server: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  const byId = new Set<string>();
  const byStamp = new Set<string>();
  const merged: ChatMessage[] = [];

  for (const m of server) {
    byId.add(m.id);
    byStamp.add(`${m.createdAt}:${m.body}`);
    merged.push(m);
  }
  for (const m of local) {
    if (byId.has(m.id) || byStamp.has(`${m.createdAt}:${m.body}`)) continue;
    byId.add(m.id);
    byStamp.add(`${m.createdAt}:${m.body}`);
    merged.push(m);
  }
  merged.sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
  return merged.slice(-200);
}

export function getLocalMessagesForPeer(
  phoneE164: string,
  peer: Pick<PublicUser, 'id' | 'phoneE164'>
): ChatMessage[] {
  const snap = loadLocalHistory(phoneE164);
  if (peer.phoneE164 && snap.threads[peer.phoneE164]?.messages) {
    return snap.threads[peer.phoneE164].messages;
  }
  if (snap.threads[peer.id]?.messages) {
    return snap.threads[peer.id].messages;
  }
  for (const t of Object.values(snap.threads)) {
    if (t.peerId === peer.id || (peer.phoneE164 && t.peerPhone === peer.phoneE164)) {
      return t.messages;
    }
  }
  return [];
}

export function saveLocalMessagesForPeer(
  phoneE164: string,
  selfUserId: string,
  peer: Pick<PublicUser, 'id' | 'phoneE164'>,
  messages: ChatMessage[]
): void {
  if (!phoneE164) return;
  const snap = loadLocalHistory(phoneE164);
  if (selfUserId) snap.selfUserId = selfUserId;
  const key = peer.phoneE164 || peer.id;
  if (!key) return;
  snap.threads[key] = {
    peerId: peer.id,
    peerPhone: peer.phoneE164,
    messages: messages.slice(-200),
  };
  saveLocalHistory(snap);
}

export function buildHistoryRestorePayload(
  snap: LocalHistorySnapshot,
  currentSelfUserId: string
): {
  peers: Array<{ phoneE164: string; displayName: string; countryIso: string }>;
  calls: Array<{
    id: string;
    peerPhone: string;
    peerName: string;
    peerCountryIso: string;
    direction: 'incoming' | 'outgoing';
    callType: 'audio' | 'video';
    status: string;
    startedAt: number;
    endedAt: number | null;
    durationSec: number;
  }>;
  messages: Array<{
    id: string;
    peerPhone: string;
    senderIsSelf: boolean;
    body: string;
    imageUrl: string | null;
    status: string;
    createdAt: number;
  }>;
} {
  const peerById = new Map<string, { phoneE164: string; displayName: string; countryIso: string }>();
  const peersByPhone = new Map<string, { phoneE164: string; displayName: string; countryIso: string }>();

  const registerPeer = (u: Partial<PublicUser> | undefined) => {
    if (!u || !u.phoneE164) return;
    const entry = {
      phoneE164: u.phoneE164,
      displayName: u.displayName || '',
      countryIso: u.countryIso || 'US',
    };
    if (u.id) peerById.set(u.id, entry);
    peersByPhone.set(u.phoneE164, entry);
  };

  for (const f of snap.friendsList) registerPeer(f);
  for (const h of snap.homeFeed) registerPeer(h.peer);

  const calls: Array<{
    id: string;
    peerPhone: string;
    peerName: string;
    peerCountryIso: string;
    direction: 'incoming' | 'outgoing';
    callType: 'audio' | 'video';
    status: string;
    startedAt: number;
    endedAt: number | null;
    durationSec: number;
  }> = [];

  for (const c of snap.calls) {
    const p = peerById.get(c.peerId);
    if (!p?.phoneE164) continue;
    calls.push({
      id: c.id,
      peerPhone: p.phoneE164,
      peerName: c.peerName || p.displayName,
      peerCountryIso: c.peerCountryIso || p.countryIso,
      direction: c.direction,
      callType: c.callType,
      status: c.status,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationSec: c.durationSec,
    });
  }

  const messages: Array<{
    id: string;
    peerPhone: string;
    senderIsSelf: boolean;
    body: string;
    imageUrl: string | null;
    status: string;
    createdAt: number;
  }> = [];

  const oldSelfId = snap.selfUserId || currentSelfUserId;
  for (const [key, thread] of Object.entries(snap.threads)) {
    const peerInfo =
      (thread.peerPhone ? peersByPhone.get(thread.peerPhone) : undefined) ||
      peerById.get(thread.peerId);
    const peerPhone = thread.peerPhone || peerInfo?.phoneE164 || (key.startsWith('+') ? key : '');
    if (!peerPhone) continue;
    for (const m of thread.messages) {
      const senderIsSelf =
        m.senderId === currentSelfUserId ||
        m.senderId === oldSelfId ||
        (m.receiverId === thread.peerId && m.senderId !== thread.peerId);
      messages.push({
        id: m.id,
        peerPhone,
        senderIsSelf,
        body: m.body,
        imageUrl: m.imageUrl,
        status: m.status,
        createdAt: m.createdAt,
      });
    }
  }

  return {
    peers: Array.from(peersByPhone.values()).slice(0, 200),
    calls: calls.slice(0, 200),
    messages: messages.slice(-500),
  };
}
