import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  db,
  isBlockedBetween,
  getPublicUserView,
  type UserRow,
} from './db.ts';
import { hashWithServerSecret } from './security.ts';

const userSockets = new Map<string, Set<WebSocket>>();
const backgroundStreams = new Map<string, Set<ServerResponse>>();
const ringTimeouts = new Map<string, NodeJS.Timeout>();
const deliveredCallIds = new Set<string>();

export function notifyCallerRinging(callId: string, callerId: string): void {
  if (deliveredCallIds.has(callId)) return;
  deliveredCallIds.add(callId);
  sendToUser(callerId, { type: 'call:ringing', callId });
}

interface CallSignalCache {
  callerId: string;
  calleeId: string;
  offer?: unknown;
  answer?: unknown;
  callerIce: unknown[];
  calleeIce: unknown[];
  relayActivated: boolean;
  updatedAt: number;
}

const activeCallSignals = new Map<string, CallSignalCache>();

const BG_EVENT_TYPES = new Set([
  'call:incoming',
  'call:ringing',
  'call:ended',
  'call:rejected',
  'call:accepted',
  'calls:refresh',
  'chat:message',
  'friend_request:new',
  'friend_request:accepted',
]);

export function isUserOnline(userId: string): boolean {
  const wsSet = userSockets.get(userId);
  if (wsSet && wsSet.size > 0) return true;
  const bgSet = backgroundStreams.get(userId);
  return Boolean(bgSet && bgSet.size > 0);
}

export function registerBackgroundStream(userId: string, res: ServerResponse): void {
  let set = backgroundStreams.get(userId);
  const wasOffline = !isUserOnline(userId);
  if (!set) {
    set = new Set<ServerResponse>();
    backgroundStreams.set(userId, set);
  }
  set.add(res);
  db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), userId);
  if (wasOffline) {
    broadcastPresenceToFriends(userId, true);
  }
}

export function unregisterBackgroundStream(userId: string, res: ServerResponse): void {
  const set = backgroundStreams.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    backgroundStreams.delete(userId);
    if (!isUserOnline(userId)) {
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), userId);
      broadcastPresenceToFriends(userId, false);
    }
  }
}

export function sendToUser(userId: string, payload: unknown): boolean {
  const serialized = JSON.stringify(payload);
  let sent = false;

  const sockets = userSockets.get(userId);
  if (sockets && sockets.size > 0) {
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(serialized);
        sent = true;
      }
    }
  }

  const eventType =
    typeof payload === 'object' && payload !== null && 'type' in payload
      ? String((payload as { type: unknown }).type)
      : '';

  if (BG_EVENT_TYPES.has(eventType)) {
    const bgSet = backgroundStreams.get(userId);
    if (bgSet && bgSet.size > 0) {
      const sseFrame = `data: ${serialized}\n\n`;
      for (const res of bgSet) {
        if (!res.writableEnded) {
          res.write(sseFrame);
          sent = true;
        }
      }
    }
  }

  return sent;
}

function broadcastPresenceToFriends(userId: string, online: boolean) {
  const user = db.prepare('SELECT show_online_status FROM users WHERE id = ?').get(userId) as
    | { show_online_status: number }
    | undefined;
  if (!user || !user.show_online_status) return;

  const peerIds = new Set<string>();
  const friends = db
    .prepare(
      `SELECT CASE WHEN user_a = ? THEN user_b ELSE user_a END AS peer_id
       FROM friendships WHERE user_a = ? OR user_b = ?`
    )
    .all(userId, userId, userId) as Array<{ peer_id: string }>;
  for (const row of friends) peerIds.add(row.peer_id);

  const recentCallPeers = db
    .prepare(
      `SELECT DISTINCT CASE WHEN caller_id = ? THEN callee_id ELSE caller_id END AS peer_id
       FROM call_records WHERE caller_id = ? OR callee_id = ?
       LIMIT 100`
    )
    .all(userId, userId, userId) as Array<{ peer_id: string }>;
  for (const row of recentCallPeers) peerIds.add(row.peer_id);

  const recentMsgPeers = db
    .prepare(
      `SELECT DISTINCT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS peer_id
       FROM messages WHERE sender_id = ? OR receiver_id = ?
       LIMIT 100`
    )
    .all(userId, userId, userId) as Array<{ peer_id: string }>;
  for (const row of recentMsgPeers) peerIds.add(row.peer_id);

  for (const peerId of peerIds) {
    if (peerId === userId) continue;
    sendToUser(peerId, {
      type: 'presence:update',
      userId,
      online,
      lastSeenAt: Date.now(),
    });
  }
}

function authenticateToken(rawToken: string | null): string | null {
  if (!rawToken) return null;
  const tokenHash = hashWithServerSecret(rawToken);
  const now = Date.now();
  const row = db
    .prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(tokenHash, now) as { user_id: string } | undefined;
  return row ? row.user_id : null;
}

function parseCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'easycall_sid') {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

function clearRingTimeout(callId: string) {
  const timer = ringTimeouts.get(callId);
  if (timer) {
    clearTimeout(timer);
    ringTimeouts.delete(callId);
  }
}

function replayCachedSignalsForUser(ws: WebSocket, userId: string, onlyCallId?: string) {
  const now = Date.now();
  const activeCalls = db
    .prepare(
      `SELECT id, caller_id, callee_id, status, started_at
       FROM call_records
       WHERE (caller_id = ? OR callee_id = ?)
         AND status = 'active'
         AND started_at > ?`
    )
    .all(userId, userId, now - 10 * 60_000) as Array<{
    id: string;
    caller_id: string;
    callee_id: string;
    status: string;
    started_at: number;
  }>;

  for (const call of activeCalls) {
    if (onlyCallId && call.id !== onlyCallId) continue;
    const cache = activeCallSignals.get(call.id);
    if (!cache) continue;
    const isCaller = call.caller_id === userId;
    const peerId = isCaller ? call.callee_id : call.caller_id;

    if (isCaller) {
      if (cache.answer) {
        ws.send(
          JSON.stringify({
            type: 'webrtc:answer',
            callId: call.id,
            targetUserId: userId,
            fromUserId: peerId,
            sdp: cache.answer,
          })
        );
      }
      for (const cand of cache.calleeIce) {
        ws.send(
          JSON.stringify({
            type: 'webrtc:ice-candidate',
            callId: call.id,
            targetUserId: userId,
            fromUserId: peerId,
            candidate: cand,
          })
        );
      }
    } else {
      if (cache.offer) {
        ws.send(
          JSON.stringify({
            type: 'webrtc:offer',
            callId: call.id,
            targetUserId: userId,
            fromUserId: peerId,
            sdp: cache.offer,
          })
        );
      }
      for (const cand of cache.callerIce) {
        ws.send(
          JSON.stringify({
            type: 'webrtc:ice-candidate',
            callId: call.id,
            targetUserId: userId,
            fromUserId: peerId,
            candidate: cand,
          })
        );
      }
    }

    if (cache.relayActivated) {
      ws.send(
        JSON.stringify({
          type: 'relay:activate',
          callId: call.id,
          targetUserId: userId,
          fromUserId: peerId,
        })
      );
    }
  }
}

export function acceptIncomingCallById(callId: string, userId: string): {
  ok: boolean;
  alreadyActive?: boolean;
} {
  const call = db
    .prepare('SELECT * FROM call_records WHERE id = ? AND callee_id = ?')
    .get(callId, userId) as
    | { id: string; caller_id: string; callee_id: string; status: string }
    | undefined;
  if (!call) return { ok: false };
  if (call.status === 'active') {
    return { ok: true, alreadyActive: true };
  }
  if (call.status !== 'ringing') {
    return { ok: false };
  }

  clearRingTimeout(callId);
  deliveredCallIds.delete(callId);
  const now = Date.now();
  db.prepare(`UPDATE call_records SET status = 'active', answered_at = ?, callee_seen = 1 WHERE id = ?`).run(
    now,
    callId
  );

  if (!activeCallSignals.has(callId)) {
    activeCallSignals.set(callId, {
      callerId: call.caller_id,
      calleeId: call.callee_id,
      callerIce: [],
      calleeIce: [],
      relayActivated: false,
      updatedAt: now,
    });
  }

  sendToUser(call.caller_id, {
    type: 'call:accepted',
    callId,
    byUserId: userId,
  });
  // Notify callee's background service / other windows to stop ringing immediately
  sendToUser(call.callee_id, {
    type: 'call:accepted',
    callId,
    byUserId: userId,
  });

  return { ok: true };
}

export function rejectIncomingCallById(callId: string, userId: string): boolean {
  const call = db
    .prepare('SELECT * FROM call_records WHERE id = ? AND callee_id = ?')
    .get(callId, userId) as
    | { id: string; caller_id: string; callee_id: string; status: string }
    | undefined;
  if (!call || call.status !== 'ringing') return false;

  clearRingTimeout(callId);
  deliveredCallIds.delete(callId);
  activeCallSignals.delete(callId);
  db.prepare(
    `UPDATE call_records SET status = 'rejected', ended_at = ?, callee_seen = 0 WHERE id = ?`
  ).run(Date.now(), callId);

  sendToUser(call.caller_id, {
    type: 'call:rejected',
    callId,
    byUserId: userId,
  });
  sendToUser(call.callee_id, {
    type: 'call:ended',
    callId,
    reason: 'rejected',
  });
  sendToUser(call.caller_id, { type: 'calls:refresh' });
  sendToUser(call.callee_id, { type: 'calls:refresh' });
  return true;
}

export function initWebSocketServer(httpServer: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    }
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const reqUrl = new URL(req.url || '/ws', 'http://localhost');
    const queryToken = reqUrl.searchParams.get('token');
    const cookieToken = parseCookieToken(req.headers.cookie);

    let authedUserId: string | null = authenticateToken(queryToken || cookieToken);

    const registerSocket = (userId: string) => {
      let set = userSockets.get(userId);
      const wasOffline = !isUserOnline(userId);
      if (!set) {
        set = new Set<WebSocket>();
        userSockets.set(userId, set);
      }
      set.add(ws);
      db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(Date.now(), userId);
      if (wasOffline) {
        broadcastPresenceToFriends(userId, true);
      }
      ws.send(JSON.stringify({ type: 'ws:ready', userId }));
      replayCachedSignalsForUser(ws, userId);

      // Deliver any active pending incoming call queued while this user was offline
      const cutoff = Date.now() - 45_000;
      const pendingIncoming = db
        .prepare(
          `SELECT id, caller_id, call_type FROM call_records
           WHERE callee_id = ? AND status = 'ringing' AND started_at > ?
           ORDER BY started_at DESC LIMIT 1`
        )
        .get(userId, cutoff) as
        | { id: string; caller_id: string; call_type: 'audio' | 'video' }
        | undefined;
      if (pendingIncoming) {
        const callerRow = db
          .prepare('SELECT * FROM users WHERE id = ?')
          .get(pendingIncoming.caller_id) as UserRow | undefined;
        if (callerRow && !isBlockedBetween(userId, callerRow.id)) {
          ws.send(
            JSON.stringify({
              type: 'call:incoming',
              callId: pendingIncoming.id,
              callType: pendingIncoming.call_type,
              caller: getPublicUserView(callerRow, true),
            })
          );
          notifyCallerRinging(pendingIncoming.id, pendingIncoming.caller_id);
        }
      }
    };

    if (authedUserId) {
      registerSocket(authedUserId);
    }

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'auth' && typeof msg.token === 'string') {
        const uid = authenticateToken(msg.token);
        if (uid) {
          authedUserId = uid;
          registerSocket(uid);
        } else {
          ws.send(JSON.stringify({ type: 'ws:error', error: 'Unauthorized' }));
        }
        return;
      }

      if (!authedUserId) {
        ws.send(JSON.stringify({ type: 'ws:error', error: 'Not authenticated' }));
        return;
      }

      const userId = authedUserId;

      if (msg.type === 'ping') {
        const nowTs = Date.now();
        db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowTs, userId);
        ws.send(JSON.stringify({ type: 'pong', ts: nowTs }));
        return;
      }

      if (msg.type === 'call:initiate') {
        const targetUserId = typeof msg.targetUserId === 'string' ? msg.targetUserId : '';
        const callType = msg.callType === 'video' ? 'video' : 'audio';

        if (!targetUserId || targetUserId === userId) return;
        const targetRow = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId) as
          | { id: string }
          | undefined;
        if (!targetRow) {
          ws.send(
            JSON.stringify({
              type: 'call:error',
              code: 'NOT_FOUND',
              message: 'Contact account not found.',
            })
          );
          return;
        }
        if (isBlockedBetween(userId, targetUserId)) {
          ws.send(
            JSON.stringify({
              type: 'call:error',
              code: 'PERMISSION_DENIED',
              message: 'Cannot call this user because a block is active.',
            })
          );
          return;
        }

        const callerRow = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as
          | UserRow
          | undefined;
        if (!callerRow) return;

        const callId = crypto.randomUUID();
        const now = Date.now();
        // Expire any stale ringing calls for this caller/callee pair so old calls never block new ones
        db.prepare(
          `UPDATE call_records
           SET status = 'missed', ended_at = ?
           WHERE status = 'ringing' AND (caller_id = ? OR (callee_id = ? AND started_at < ?))`
        ).run(now, userId, targetUserId, now - 45_000);

        db.prepare(
          `INSERT INTO call_records (id, caller_id, callee_id, call_type, status, started_at)
           VALUES (?, ?, ?, ?, 'ringing', ?)`
        ).run(callId, userId, targetUserId, callType, now);
        activeCallSignals.set(callId, {
          callerId: userId,
          calleeId: targetUserId,
          callerIce: [],
          calleeIce: [],
          relayActivated: false,
          updatedAt: now,
        });

        const targetOnline = isUserOnline(targetUserId);
        ws.send(
          JSON.stringify({
            type: 'call:created',
            callId,
            targetUserId,
            callType,
            targetOnline,
          })
        );

        if (targetOnline) {
          const delivered = sendToUser(targetUserId, {
            type: 'call:incoming',
            callId,
            callType,
            caller: getPublicUserView(callerRow, true),
          });
          if (delivered) {
            notifyCallerRinging(callId, userId);
          }
        }

        const timeout = setTimeout(() => {
          const row = db
            .prepare('SELECT status, caller_id, callee_id, call_type FROM call_records WHERE id = ?')
            .get(callId) as
            | { status: string; caller_id: string; callee_id: string; call_type: string }
            | undefined;
          if (row && row.status === 'ringing') {
            const endedAt = Date.now();
            db.prepare(
              `UPDATE call_records SET status = 'missed', ended_at = ?, callee_seen = 0 WHERE id = ?`
            ).run(endedAt, callId);

            const caller = db
              .prepare('SELECT display_name, phone_e164 FROM users WHERE id = ?')
              .get(row.caller_id) as { display_name: string; phone_e164: string } | undefined;
            const callerName = caller?.display_name || caller?.phone_e164 || 'Someone';
            const notifId = crypto.randomUUID();
            db.prepare(
              `INSERT INTO notifications (id, user_id, type, title, body, related_user_id, created_at)
               VALUES (?, ?, 'missed_call', 'Missed call', ?, ?, ?)`
            ).run(
              notifId,
              row.callee_id,
              `Missed ${row.call_type} call from ${callerName}`,
              row.caller_id,
              endedAt
            );

            sendToUser(row.caller_id, { type: 'call:ended', callId, reason: 'no_answer' });
            sendToUser(row.callee_id, {
              type: 'call:ended',
              callId,
              reason: 'missed',
            });
            sendToUser(row.caller_id, { type: 'calls:refresh' });
            sendToUser(row.callee_id, { type: 'calls:refresh' });
            sendToUser(row.callee_id, { type: 'notifications:refresh' });
          }
          deliveredCallIds.delete(callId);
          ringTimeouts.delete(callId);
        }, 45_000);
        ringTimeouts.set(callId, timeout);
        return;
      }

      if (msg.type === 'call:accept') {
        const callId = typeof msg.callId === 'string' ? msg.callId : '';
        if (callId) {
          acceptIncomingCallById(callId, userId);
        }
        return;
      }

      if (msg.type === 'call:sync') {
        const callId = typeof msg.callId === 'string' ? msg.callId : undefined;
        replayCachedSignalsForUser(ws, userId, callId);
        return;
      }

      if (msg.type === 'call:reject') {
        const callId = typeof msg.callId === 'string' ? msg.callId : '';
        rejectIncomingCallById(callId, userId);
        return;
      }

      if (msg.type === 'call:end') {
        const callId = typeof msg.callId === 'string' ? msg.callId : '';
        const call = db
          .prepare('SELECT * FROM call_records WHERE id = ? AND (caller_id = ? OR callee_id = ?)')
          .get(callId, userId, userId) as
          | {
              id: string;
              caller_id: string;
              callee_id: string;
              call_type: string;
              status: string;
              answered_at: number | null;
            }
          | undefined;
        if (!call || ['completed', 'missed', 'rejected', 'cancelled'].includes(call.status)) return;

        clearRingTimeout(callId);
        deliveredCallIds.delete(callId);
        activeCallSignals.delete(callId);
        const endedAt = Date.now();
        let nextStatus = 'completed';
        let durationSec = 0;
        let calleeSeenVal = 1;

        if (call.answered_at) {
          durationSec = Math.max(1, Math.round((endedAt - call.answered_at) / 1000));
          nextStatus = 'completed';
          calleeSeenVal = 1;
        } else {
          nextStatus = userId === call.caller_id ? 'cancelled' : 'missed';
          calleeSeenVal = 0;
          if (nextStatus === 'cancelled') {
            const caller = db
              .prepare('SELECT display_name, phone_e164 FROM users WHERE id = ?')
              .get(call.caller_id) as { display_name: string; phone_e164: string } | undefined;
            const notifId = crypto.randomUUID();
            db.prepare(
              `INSERT INTO notifications (id, user_id, type, title, body, related_user_id, created_at)
               VALUES (?, ?, 'missed_call', 'Missed call', ?, ?, ?)`
            ).run(
              notifId,
              call.callee_id,
              `Missed ${call.call_type} call from ${caller?.display_name || caller?.phone_e164 || 'Contact'}`,
              call.caller_id,
              endedAt
            );
            sendToUser(call.callee_id, { type: 'notifications:refresh' });
          }
        }

        db.prepare(
          `UPDATE call_records SET status = ?, ended_at = ?, duration_sec = ?, callee_seen = ? WHERE id = ?`
        ).run(nextStatus, endedAt, durationSec, calleeSeenVal, callId);

        const peerId = call.caller_id === userId ? call.callee_id : call.caller_id;
        sendToUser(peerId, {
          type: 'call:ended',
          callId,
          reason: 'hangup',
          durationSec,
        });
        sendToUser(call.caller_id, { type: 'calls:refresh' });
        sendToUser(call.callee_id, { type: 'calls:refresh' });
        return;
      }

      if (
        msg.type === 'webrtc:offer' ||
        msg.type === 'webrtc:answer' ||
        msg.type === 'webrtc:ice-candidate' ||
        msg.type === 'webrtc:media-state' ||
        msg.type === 'relay:activate' ||
        msg.type === 'relay:audio' ||
        msg.type === 'relay:video'
      ) {
        const callId = typeof msg.callId === 'string' ? msg.callId : '';
        const targetUserId = typeof msg.targetUserId === 'string' ? msg.targetUserId : '';
        if (!callId || !targetUserId) return;

        const call = db
          .prepare(
            `SELECT caller_id, callee_id FROM call_records
             WHERE id = ? AND ((caller_id = ? AND callee_id = ?) OR (caller_id = ? AND callee_id = ?))`
          )
          .get(callId, userId, targetUserId, targetUserId, userId) as
          | { caller_id: string; callee_id: string }
          | undefined;

        if (!call || isBlockedBetween(userId, targetUserId)) {
          return;
        }

        if (
          msg.type === 'webrtc:offer' ||
          msg.type === 'webrtc:answer' ||
          msg.type === 'webrtc:ice-candidate' ||
          msg.type === 'relay:activate'
        ) {
          let cache = activeCallSignals.get(callId);
          if (!cache) {
            cache = {
              callerId: call.caller_id,
              calleeId: call.callee_id,
              callerIce: [],
              calleeIce: [],
              relayActivated: false,
              updatedAt: Date.now(),
            };
            activeCallSignals.set(callId, cache);
          }
          cache.updatedAt = Date.now();
          if (msg.type === 'webrtc:offer' && msg.sdp) {
            cache.offer = msg.sdp;
          } else if (msg.type === 'webrtc:answer' && msg.sdp) {
            cache.answer = msg.sdp;
          } else if (msg.type === 'webrtc:ice-candidate' && msg.candidate) {
            if (userId === call.caller_id && cache.callerIce.length < 30) {
              cache.callerIce.push(msg.candidate);
            } else if (userId === call.callee_id && cache.calleeIce.length < 30) {
              cache.calleeIce.push(msg.candidate);
            }
          } else if (msg.type === 'relay:activate') {
            cache.relayActivated = true;
          }
        }

        sendToUser(targetUserId, {
          ...msg,
          fromUserId: userId,
        });
        return;
      }

      if (msg.type === 'chat:typing') {
        const targetUserId = typeof msg.targetUserId === 'string' ? msg.targetUserId : '';
        if (!targetUserId || isBlockedBetween(userId, targetUserId)) {
          return;
        }
        sendToUser(targetUserId, {
          type: 'chat:typing',
          fromUserId: userId,
          isTyping: Boolean(msg.isTyping),
        });
      }
    });

    ws.on('close', () => {
      if (!authedUserId) return;
      const set = userSockets.get(authedUserId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          userSockets.delete(authedUserId);
          if (!isUserOnline(authedUserId)) {
            db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(
              Date.now(),
              authedUserId
            );
            broadcastPresenceToFriends(authedUserId, false);
          }
        }
      }
    });
  });

  return wss;
}
