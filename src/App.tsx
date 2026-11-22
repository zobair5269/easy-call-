import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Download, Home, Moon, PhoneCall, Settings, Sun, Users } from 'lucide-react';
import { AdminBuilderPage } from './components/AdminBuilderPage';
import { Avatar } from './components/Avatar';
import { CallOverlay, type ActiveCallSession } from './components/CallOverlay';
import { CallsTab } from './components/CallsTab';
import { ChatDrawer } from './components/ChatDrawer';
import { ContactsPanel } from './components/ContactsPanel';
import { HomeTab } from './components/HomeTab';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { ProfileSettingsTab } from './components/ProfileSettingsTab';
import { QrModal } from './components/QrModal';
import { WelcomeAuth } from './components/WelcomeAuth';
import { detectDeviceLanguage, getLanguageMeta, translate, type TranslationKeys } from './i18n/translations';
import { apiFetch, buildWsUrl, getAuthToken, initApiConfig, resolveApiUrl, setAuthToken } from './lib/api';
import { ringtone } from './lib/ringtone';
import type {
  ActiveTab,
  AppNotification,
  CallRecordItem,
  ChatMessage,
  FriendRequestItem,
  PublicUser,
  SelfUser,
} from './types/app';

export default function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(
    () => typeof window !== 'undefined' && window.location.pathname.startsWith('/admin')
  );

  useEffect(() => {
    const onPop = () => {
      setIsAdminRoute(window.location.pathname.startsWith('/admin'));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (isAdminRoute) {
    return (
      <AdminBuilderPage
        onBackToApp={() => {
          window.history.pushState({}, '', '/');
          setIsAdminRoute(false);
        }}
      />
    );
  }

  return (
    <MainEasyCallApp
      onOpenAdmin={() => {
        window.history.pushState({}, '', '/admin');
        setIsAdminRoute(true);
      }}
    />
  );
}

function MainEasyCallApp({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<SelfUser | null>(null);
  const [isAdminEligible, setIsAdminEligible] = useState(false);
  const [language, setLanguage] = useState<string>(() => detectDeviceLanguage());
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [friends, setFriends] = useState<PublicUser[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);
  const [calls, setCalls] = useState<CallRecordItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [qrOpen, setQrOpen] = useState(false);
  const [qrInitialTab, setQrInitialTab] = useState<'my' | 'scan'>('my');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeChatFriend, setActiveChatFriend] = useState<PublicUser | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  // WebRTC & Signaling State
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<{ callId: string; fromUserId: string; sdp: RTCSessionDescriptionInit } | null>(null);
  const callSessionRef = useRef<ActiveCallSession | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);

  const [callSession, setCallSession] = useState<ActiveCallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [callDurationSec, setCallDurationSec] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [callNotice, setCallNotice] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const t = useCallback((key: TranslationKeys) => translate(language, key), [language]);

  // Apply Dark Mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [darkMode]);

  // Apply Language & RTL/LTR direction on <html>
  useEffect(() => {
    const meta = getLanguageMeta(language);
    document.documentElement.lang = meta.code;
    document.documentElement.dir = meta.dir;
  }, [language]);

  // Track browser network connectivity
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  // Sync callSessionRef & active duration timer
  useEffect(() => {
    callSessionRef.current = callSession;
    if (!callSession || callSession.phase !== 'connected') {
      if (!callSession) setCallDurationSec(0);
      return;
    }
    const timer = window.setInterval(() => {
      setCallDurationSec((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [callSession]);

  // Load ICE servers & attempt session restore via HttpOnly cookie
  useEffect(() => {
    initApiConfig().finally(() => {
      apiFetch<{ iceServers: RTCIceServer[] }>('/api/rtc-config')
        .then((res) => {
          if (Array.isArray(res.iceServers) && res.iceServers.length > 0) {
            iceServersRef.current = res.iceServers;
          }
        })
        .catch(() => {});

      apiFetch<{ user: SelfUser }>('/api/users/me')
        .then((res) => {
          setUser(res.user);
          setLanguage(res.user.language || detectDeviceLanguage());
        })
        .catch(() => {})
        .finally(() => setBooting(false));
    });
  }, []);

  const refreshAllData = useCallback(async () => {
    if (!user) return;
    try {
      const [frRes, reqRes, callRes, notifRes] = await Promise.all([
        apiFetch<{ friends: PublicUser[] }>('/api/friends'),
        apiFetch<{ incoming: FriendRequestItem[]; outgoing: FriendRequestItem[] }>(
          '/api/friend-requests'
        ),
        apiFetch<{ calls: CallRecordItem[] }>('/api/calls'),
        apiFetch<{ notifications: AppNotification[] }>('/api/notifications'),
      ]);
      setFriends(frRes.friends);
      setIncomingRequests(reqRes.incoming);
      setOutgoingRequests(reqRes.outgoing);
      setCalls(callRes.calls);
      setNotifications(notifRes.notifications);
    } catch {
      // Ignore transient refresh failure
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      refreshAllData();
      const tok = getAuthToken();
      fetch(resolveApiUrl('/api/admin/status'), {
        headers: tok ? { 'X-User-Token': tok } : {},
        credentials: 'include',
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((st) => {
          if (st) {
            setIsAdminEligible(Boolean(st.isAdminUser || st.authenticated));
          }
        })
        .catch(() => {});
    } else {
      setIsAdminEligible(false);
    }
  }, [user, refreshAllData]);

  const cleanupCallMedia = useCallback(() => {
    ringtone.stop();
    if (pcRef.current) {
      pcRef.current.onicecandidate = null;
      pcRef.current.ontrack = null;
      pcRef.current.onconnectionstatechange = null;
      pcRef.current.oniceconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((tr) => tr.stop());
      localStreamRef.current = null;
    }
    remoteStreamRef.current = null;
    pendingIceRef.current = [];
    pendingOfferRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setCallSession(null);
    setMuted(false);
    setCameraOff(false);
    setCallDurationSec(0);
    setMediaError(null);
  }, []);

  const acquireUserMedia = useCallback(
    async (callType: 'audio' | 'video', desiredFacing: 'user' | 'environment' = 'user') => {
      const lowBandwidth = Boolean(user?.dataSaver);
      const videoConstraints: MediaTrackConstraints | boolean =
        callType === 'video'
          ? {
              facingMode: desiredFacing,
              width: { ideal: lowBandwidth ? 320 : 1280 },
              height: { ideal: lowBandwidth ? 240 : 720 },
              frameRate: { ideal: lowBandwidth ? 15 : 30 },
            }
          : false;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: videoConstraints,
        });
        localStreamRef.current = stream;
        setLocalStream(stream);
        setMediaError(null);
        return stream;
      } catch {
        // Fallback to audio-only if camera failed on a video call, or notify user
        if (callType === 'video') {
          try {
            const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            localStreamRef.current = audioOnly;
            setLocalStream(audioOnly);
            setMediaError('Camera unavailable. Continuing with audio.');
            return audioOnly;
          } catch {
            // Fall through
          }
        }
        setMediaError('Microphone/camera permission unavailable on this device.');
        return null;
      }
    },
    [user?.dataSaver]
  );

  const createPeerConnection = useCallback(
    (callId: string, targetUserId: string) => {
      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceCandidatePoolSize: 4,
      });
      const rStream = new MediaStream();
      remoteStreamRef.current = rStream;
      setRemoteStream(rStream);

      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }

      pc.ontrack = (event) => {
        for (const stream of event.streams) {
          for (const track of stream.getTracks()) {
            rStream.addTrack(track);
          }
        }
        if (event.track && !rStream.getTracks().includes(event.track)) {
          rStream.addTrack(event.track);
        }
        setRemoteStream(new MediaStream(rStream.getTracks()));
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'webrtc:ice-candidate',
              callId,
              targetUserId,
              candidate: event.candidate.toJSON(),
            })
          );
        }
      };

      const handleStateUpdate = (state: string) => {
        if (state === 'connected' || state === 'completed') {
          ringtone.stop();
          setCallSession((prev) => (prev ? { ...prev, phase: 'connected' } : prev));
        } else if (state === 'disconnected' || state === 'failed') {
          setCallSession((prev) => (prev ? { ...prev, phase: 'reconnecting' } : prev));
          try {
            pc.restartIce();
          } catch {
            // Ignore restartIce errors
          }
        }
      };

      pc.onconnectionstatechange = () => handleStateUpdate(pc.connectionState);
      pc.oniceconnectionstatechange = () => handleStateUpdate(pc.iceConnectionState);

      pcRef.current = pc;
      return pc;
    },
    []
  );

  // Connect & maintain WebSocket
  useEffect(() => {
    if (!user) {
      setWsConnected(false);
      return;
    }
    let disposed = false;
    let reconnectTimer: number | null = null;

    const connectWs = () => {
      if (disposed) return;
      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        if (!disposed) setWsConnected(true);
      };

      ws.onmessage = async (event) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (msg.type === 'ws:ready') {
          setWsConnected(true);
        } else if (msg.type === 'presence:update') {
          const uid = String(msg.userId);
          const online = Boolean(msg.online);
          setFriends((prev) =>
            prev.map((f) => (f.id === uid ? { ...f, online } : f))
          );
        } else if (msg.type === 'friend_request:new' || msg.type === 'friend_request:accepted' || msg.type === 'friends:refresh' || msg.type === 'notifications:refresh') {
          refreshAllData();
          if (msg.type === 'friend_request:new' && 'Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification('EASY CALL', { body: 'You received a new Friend Request.' });
            } catch {
              // Android WebView may disallow direct Notification constructor
            }
          }
        } else if (msg.type === 'chat:message' && msg.message) {
          const m = msg.message as ChatMessage;
          setLiveMessages((prev) => [...prev, m]);
        } else if (msg.type === 'call:created') {
          const callId = String(msg.callId);
          if (callSessionRef.current) {
            callSessionRef.current = { ...callSessionRef.current, callId };
          }
          setCallSession((prev) => (prev ? { ...prev, callId } : prev));
        } else if (msg.type === 'call:unavailable') {
          cleanupCallMedia();
          refreshAllData();
          setCallNotice('This contact is currently offline. A missed call notification was saved.');
          window.setTimeout(() => setCallNotice(null), 5000);
        } else if (msg.type === 'call:error') {
          cleanupCallMedia();
          refreshAllData();
          setCallNotice(typeof msg.message === 'string' ? msg.message : 'Unable to connect call.');
          window.setTimeout(() => setCallNotice(null), 5000);
        } else if (msg.type === 'call:incoming') {
          const callId = String(msg.callId);
          const callType = msg.callType === 'video' ? 'video' : 'audio';
          const caller = msg.caller as PublicUser;
          if (callSessionRef.current) {
            ws.send(JSON.stringify({ type: 'call:reject', callId }));
            return;
          }
          ringtone.startIncoming();
          setCallSession({
            callId,
            direction: 'incoming',
            callType,
            peer: caller,
            phase: 'ringing',
            startedAt: Date.now(),
          });
          if ('Notification' in window && Notification.permission === 'granted') {
            try {
              new Notification(`Incoming ${callType} call`, {
                body: `${caller.displayName} is calling you on EASY CALL`,
              });
            } catch {
              // Android WebView may disallow direct Notification constructor
            }
          }
        } else if (msg.type === 'call:accepted') {
          const callId = String(msg.callId);
          const current = callSessionRef.current;
          if (!current || current.callId !== callId) return;
          ringtone.stop();
          setCallSession((prev) => (prev ? { ...prev, phase: 'connecting' } : prev));

          const pc = createPeerConnection(callId, current.peer.id);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          ws.send(
            JSON.stringify({
              type: 'webrtc:offer',
              callId,
              targetUserId: current.peer.id,
              sdp: pc.localDescription,
            })
          );
        } else if (msg.type === 'call:rejected' || msg.type === 'call:ended') {
          cleanupCallMedia();
          refreshAllData();
        } else if (msg.type === 'webrtc:offer') {
          const callId = String(msg.callId);
          const fromUserId = String(msg.fromUserId);
          const sdp = msg.sdp as RTCSessionDescriptionInit;

          if (!pcRef.current) {
            pendingOfferRef.current = { callId, fromUserId, sdp };
            return;
          }
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
          for (const cand of pendingIceRef.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
          pendingIceRef.current = [];
          const answer = await pcRef.current.createAnswer();
          await pcRef.current.setLocalDescription(answer);
          ws.send(
            JSON.stringify({
              type: 'webrtc:answer',
              callId,
              targetUserId: fromUserId,
              sdp: pcRef.current.localDescription,
            })
          );
        } else if (msg.type === 'webrtc:answer') {
          const sdp = msg.sdp as RTCSessionDescriptionInit;
          if (pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
            for (const cand of pendingIceRef.current) {
              await pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
            pendingIceRef.current = [];
          }
        } else if (msg.type === 'webrtc:ice-candidate' && msg.candidate) {
          const cand = msg.candidate as RTCIceCandidateInit;
          if (pcRef.current && pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          } else {
            pendingIceRef.current.push(cand);
          }
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connectWs, 2500);
        }
      };
    };

    connectWs();

    const pingInterval = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 25000);

    return () => {
      disposed = true;
      setWsConnected(false);
      clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user, refreshAllData, cleanupCallMedia, createPeerConnection]);

  const startOutgoingCall = async (peer: PublicUser, callType: 'audio' | 'video') => {
    if (callSessionRef.current) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setCallNotice('Reconnecting to call server... Please try again in a moment.');
      window.setTimeout(() => setCallNotice(null), 4000);
      return;
    }

    setCallNotice(null);
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    const sessionDraft: ActiveCallSession = {
      callId: 'pending',
      direction: 'outgoing',
      callType,
      peer,
      phase: 'ringing',
      startedAt: Date.now(),
    };
    callSessionRef.current = sessionDraft;
    setCallSession(sessionDraft);
    ringtone.startOutgoing();

    await acquireUserMedia(callType, 'user');
    if (!callSessionRef.current) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((tr) => tr.stop());
        localStreamRef.current = null;
      }
      return;
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'call:initiate',
          targetUserId: peer.id,
          callType,
        })
      );
    } else {
      cleanupCallMedia();
      setCallNotice('Connection lost while starting call. Please try again.');
      window.setTimeout(() => setCallNotice(null), 4000);
    }
  };

  const acceptIncomingCall = async () => {
    const current = callSessionRef.current;
    if (!current) return;
    ringtone.stop();
    const connectingSession: ActiveCallSession = { ...current, phase: 'connecting' };
    callSessionRef.current = connectingSession;
    setCallSession(connectingSession);

    await acquireUserMedia(current.callType, 'user');
    if (!callSessionRef.current || callSessionRef.current.callId !== current.callId) {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((tr) => tr.stop());
        localStreamRef.current = null;
      }
      return;
    }

    const pc = createPeerConnection(current.callId, current.peer.id);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'call:accept', callId: current.callId }));
    }

    if (pendingOfferRef.current && pendingOfferRef.current.callId === current.callId) {
      const { sdp, fromUserId } = pendingOfferRef.current;
      pendingOfferRef.current = null;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      for (const cand of pendingIceRef.current) {
        await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
      pendingIceRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      wsRef.current?.send(
        JSON.stringify({
          type: 'webrtc:answer',
          callId: current.callId,
          targetUserId: fromUserId,
          sdp: pc.localDescription,
        })
      );
    }
  };

  const rejectIncomingCall = () => {
    const current = callSessionRef.current;
    if (current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'call:reject', callId: current.callId }));
    }
    cleanupCallMedia();
    refreshAllData();
  };

  const endActiveCall = () => {
    const current = callSessionRef.current;
    if (current && current.callId !== 'pending' && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'call:end', callId: current.callId }));
    }
    cleanupCallMedia();
    refreshAllData();
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getAudioTracks()) {
        track.enabled = !next;
      }
    }
  };

  const toggleCamera = () => {
    const next = !cameraOff;
    setCameraOff(next);
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getVideoTracks()) {
        track.enabled = !next;
      }
    }
  };

  const flipCamera = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);
    if (!localStreamRef.current) return;
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextMode },
        audio: false,
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!newVideoTrack) return;
      const oldVideoTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldVideoTrack) {
        localStreamRef.current.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      localStreamRef.current.addTrack(newVideoTrack);
      setLocalStream(new MediaStream(localStreamRef.current.getTracks()));

      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        await sender.replaceTrack(newVideoTrack);
      }
    } catch {
      // Device may only have one camera
    }
  };

  const unreadNotifsCount = notifications.filter((n) => !n.isRead).length;

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex flex-col items-center gap-4">
          <img
            src="/easycall-logo.png"
            alt="EASY CALL"
            className="h-16 w-16 rounded-full object-cover shadow-md"
          />
          <p className="font-display text-lg font-bold text-slate-900 dark:text-white">
            EASY CALL
          </p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <WelcomeAuth
        language={language}
        onChangeLanguage={setLanguage}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onAuthenticated={(u, tok) => {
          setAuthToken(tok);
          setUser(u);
          if (u.language) setLanguage(u.language);
        }}
        onOpenAdmin={onOpenAdmin}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-slate-50 to-teal-50/40 dark:from-slate-950 dark:via-slate-950 dark:to-teal-950/20 text-slate-900 dark:text-slate-100 pb-24 md:pb-10">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-900/90 backdrop-blur-lg shadow-xs">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 sm:gap-6 px-3 py-2.5 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className="flex items-center gap-2.5 whitespace-nowrap min-w-0 text-start"
          >
            <div className="relative shrink-0">
              <img
                src="/easycall-logo.png"
                alt="EASY CALL"
                referrerPolicy="no-referrer"
                className="h-9 w-9 rounded-full object-cover shadow-xs ring-1 ring-emerald-500/20"
              />
              <span
                title={wsConnected ? 'Connected' : 'Connecting'}
                className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                  wsConnected ? 'bg-emerald-500' : 'bg-amber-400'
                }`}
              />
            </div>
            <span className="font-display text-base sm:text-lg font-extrabold tracking-tight bg-gradient-to-r from-teal-700 to-emerald-600 dark:from-teal-300 dark:to-emerald-300 bg-clip-text text-transparent truncate">
              {t('appName')}
            </span>
          </button>

          {/* Desktop Nav Links (Top Bar Contract: clean single-line text links) */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            {(
              [
                ['home', t('navHome')],
                ['calls', t('navCalls')],
                ['contacts', t('navContacts')],
                ['settings', t('navSettings')],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`whitespace-nowrap shrink-0 py-1.5 border-b-2 transition-colors ${
                  activeTab === key
                    ? 'border-teal-700 dark:border-teal-400 text-slate-900 dark:text-white font-semibold'
                    : 'border-transparent hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {label}
                {key === 'contacts' && incomingRequests.length > 0
                  ? ` (${incomingRequests.length})`
                  : ''}
              </button>
            ))}
          </nav>

          {/* Right Controls */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {isAdminEligible && (
              <button
                type="button"
                onClick={onOpenAdmin}
                className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-gradient-to-r from-teal-700 to-emerald-700 px-2.5 sm:px-3 text-xs font-semibold text-white hover:from-teal-800 hover:to-emerald-800 shadow-xs"
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                <span>APK</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setDarkMode((d) => !d)}
              aria-label={darkMode ? t('lightMode') : t('darkMode')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </button>

            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              aria-label={t('notifications')}
              className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Bell className="h-5 w-5" />
              {unreadNotifsCount > 0 && (
                <span className="absolute top-2 end-2 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                  {unreadNotifsCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('settings')}
              aria-label={t('profileTitle')}
              className="rounded-full focus-visible:outline-2 focus-visible:outline-teal-600"
            >
              <Avatar src={user.avatarUrl} name={user.displayName || user.phoneE164} size="sm" />
            </button>
          </div>
        </div>
      </header>

      {!isOnline && (
        <div className="bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-white">
          No internet connection detected. Calls require an active internet or mobile data network.
        </div>
      )}

      {callNotice && (
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-4 py-3 text-sm font-medium text-amber-900 dark:text-amber-200 shadow-xs">
            <span>{callNotice}</span>
            <button
              type="button"
              onClick={() => setCallNotice(null)}
              className="text-xs font-bold underline shrink-0"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {activeTab === 'home' && (
          <HomeTab
            language={language}
            friends={friends}
            incomingRequests={incomingRequests}
            recentCalls={calls}
            onStartCall={startOutgoingCall}
            onOpenChat={(f) => setActiveChatFriend(f)}
            onOpenQr={() => {
              setQrInitialTab('scan');
              setQrOpen(true);
            }}
            onOpenContacts={() => setActiveTab('contacts')}
            onOpenCalls={() => setActiveTab('calls')}
            onRefreshAll={refreshAllData}
          />
        )}

        {activeTab === 'calls' && (
          <CallsTab
            language={language}
            calls={calls}
            onClearHistory={async () => {
              await apiFetch('/api/calls', { method: 'DELETE' }).catch(() => {});
              setCalls([]);
            }}
            onCallback={startOutgoingCall}
          />
        )}

        {activeTab === 'contacts' && (
          <ContactsPanel
            language={language}
            incomingRequests={incomingRequests}
            outgoingRequests={outgoingRequests}
            onRefreshAll={refreshAllData}
            onOpenQrScanner={() => {
              setQrInitialTab('scan');
              setQrOpen(true);
            }}
          />
        )}

        {activeTab === 'settings' && (
          <ProfileSettingsTab
            selfUser={user}
            language={language}
            darkMode={darkMode}
            onToggleDarkMode={() => setDarkMode((d) => !d)}
            onUserUpdated={(updated) => {
              setUser(updated);
              if (updated.language) setLanguage(updated.language);
            }}
            onOpenMyQr={() => {
              setQrInitialTab('my');
              setQrOpen(true);
            }}
            onLoggedOut={() => {
              cleanupCallMedia();
              setAuthToken(null);
              setUser(null);
              setFriends([]);
              setCalls([]);
            }}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb Navigation (<= 15% mobile height) */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe">
        <div className="grid grid-cols-4 h-16 items-center">
          {(
            [
              ['home', t('navHome'), Home, 0],
              ['calls', t('navCalls'), PhoneCall, 0],
              ['contacts', t('navContacts'), Users, incomingRequests.length],
              ['settings', t('navSettings'), Settings, 0],
            ] as const
          ).map(([key, label, Icon, badge]) => {
            const active = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`relative flex flex-col items-center justify-center min-h-[48px] ${
                  active
                    ? 'text-teal-700 dark:text-teal-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="mt-1 text-[11px] leading-none truncate max-w-[72px]">{label}</span>
                {badge > 0 && (
                  <span className="absolute top-1.5 end-5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Modals & Overlays */}
      <QrModal
        open={qrOpen}
        initialTab={qrInitialTab}
        selfUser={user}
        language={language}
        onClose={() => setQrOpen(false)}
        onRequestSent={refreshAllData}
      />

      <NotificationsDrawer
        open={notificationsOpen}
        language={language}
        notifications={notifications}
        onClose={() => setNotificationsOpen(false)}
        onMarkAllRead={async () => {
          await apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
          setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        }}
      />

      <ChatDrawer
        friend={activeChatFriend}
        selfUser={user}
        language={language}
        incomingMessages={liveMessages}
        onClose={() => setActiveChatFriend(null)}
        onStartCall={(f, type) => {
          setActiveChatFriend(null);
          startOutgoingCall(f, type);
        }}
      />

      <CallOverlay
        language={language}
        session={callSession}
        localStream={localStream}
        remoteStream={remoteStream}
        muted={muted}
        cameraOff={cameraOff}
        speakerOn={speakerOn}
        dataSaver={user.dataSaver}
        durationSec={callDurationSec}
        mediaError={mediaError}
        onAccept={acceptIncomingCall}
        onReject={rejectIncomingCall}
        onEnd={endActiveCall}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onFlipCamera={flipCamera}
        onToggleSpeaker={() => setSpeakerOn((s) => !s)}
      />
    </div>
  );
}
