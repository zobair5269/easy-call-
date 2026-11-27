import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Contact,
  MessageCircle,
  PhoneCall,
  Plus,
  QrCode,
  ScanLine,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { AdminBuilderPage } from './components/AdminBuilderPage';
import { Avatar } from './components/Avatar';
import { CallOverlay, type ActiveCallSession } from './components/CallOverlay';
import { CallsTab } from './components/CallsTab';
import { ChatDrawer } from './components/ChatDrawer';
import { ContactsPanel } from './components/ContactsPanel';
import { ContactsTabView } from './components/ContactsTabView';
import { HomeTab } from './components/HomeTab';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { PhotoViewerModal, type PhotoViewerTarget } from './components/PhotoViewerModal';
import { ProfileSettingsTab } from './components/ProfileSettingsTab';
import { QrModal } from './components/QrModal';
import { WelcomeAuth } from './components/WelcomeAuth';
import { detectDeviceLanguage, getLanguageMeta, translate, type TranslationKeys } from './i18n/translations';
import { ApiRequestError, apiFetch, buildWsUrl, getAuthToken, initApiConfig, resolveApiUrl, setAuthToken } from './lib/api';
import {
  clearNativeSessionAuth,
  consumeNativePendingAcceptCallId,
  getNativeDeviceContacts,
  hasNativeAndroidBridge,
  setNativeCallAudioMode,
  setNativeRingtone,
  setNativeSpeakerphone,
  stopNativeRinging,
  syncNativeSessionAuth,
} from './lib/nativeBridge';
import { getSelectedRingtoneId, ringtone } from './lib/ringtone';
import { WssMediaRelay } from './lib/wssMediaRelay';
import type {
  ActiveTab,
  AppNotification,
  CallRecordItem,
  ChatMessage,
  FriendRequestItem,
  HomeFeedItem,
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
  const [sessionReconnectError, setSessionReconnectError] = useState<string | null>(null);
  const [user, setUser] = useState<SelfUser | null>(null);
  const [isAdminEligible, setIsAdminEligible] = useState(false);
  const [language, setLanguage] = useState<string>(() => detectDeviceLanguage());
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [subPage, setSubPage] = useState<'calls' | 'newContacts' | null>(null);
  const [meOpen, setMeOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quickMenuOpen, setQuickMenuOpen] = useState(false);

  const [homeFeed, setHomeFeed] = useState<HomeFeedItem[]>([]);
  const [friendsList, setFriendsList] = useState<PublicUser[]>([]);
  const [calls, setCalls] = useState<CallRecordItem[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);

  const [qrOpen, setQrOpen] = useState(false);
  const [qrInitialTab, setQrInitialTab] = useState<'my' | 'scan'>('my');
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeChatFriend, setActiveChatFriend] = useState<PublicUser | null>(null);
  const [photoPreview, setPhotoPreview] = useState<PhotoViewerTarget | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const contactsSyncedUserIdRef = useRef<string | null>(null);

  // WebRTC & Signaling State
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const pendingOfferRef = useRef<{ callId: string; fromUserId: string; sdp: RTCSessionDescriptionInit } | null>(null);
  const callSessionRef = useRef<ActiveCallSession | null>(null);
  const iceServersRef = useRef<RTCIceServer[]>([{ urls: 'stun:stun.l.google.com:19302' }]);
  const relayRef = useRef<WssMediaRelay | null>(null);
  const relayFallbackTimerRef = useRef<number | null>(null);
  const relayActiveRef = useRef(false);
  const pendingAcceptCallIdRef = useRef<string | null>(null);
  const reconnectWsRef = useRef<(() => void) | null>(null);
  const lastPongAtRef = useRef<number>(Date.now());
  const pongCheckTimerRef = useRef<number | null>(null);
  const acceptIncomingCallRef = useRef<(explicitSession?: ActiveCallSession) => Promise<void>>(async () => {});
  const pendingOutIceRef = useRef<
    Array<{ callId: string; targetUserId: string; candidate: RTCIceCandidateInit }>
  >([]);
  const mutedRef = useRef(false);
  const cameraOffRef = useRef(false);
  const speakerOnRef = useRef(true);
  const dataSaverRef = useRef(false);

  const [callSession, setCallSession] = useState<ActiveCallSession | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [relayVideoFrame, setRelayVideoFrame] = useState<string | null>(null);
  const [relayActive, setRelayActive] = useState(false);
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

  // Track real network connectivity (verify against /api/health so Android WebView doesn't get stuck offline)
  useEffect(() => {
    let cancelled = false;
    const probeServer = async () => {
      try {
        await initApiConfig();
        const res = await fetch(resolveApiUrl('/api/health'), { cache: 'no-store' });
        if (!cancelled && res.ok) {
          setIsOnline(true);
        }
      } catch {
        // Leave current state
      }
    };
    const up = () => {
      setIsOnline(true);
      probeServer();
    };
    const down = () => {
      setIsOnline(false);
      window.setTimeout(probeServer, 1200);
    };
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    window.addEventListener('easycall:resume', up);
    window.addEventListener('focus', probeServer);
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      probeServer();
    }
    return () => {
      cancelled = true;
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      window.removeEventListener('easycall:resume', up);
      window.removeEventListener('focus', probeServer);
    };
  }, []);

  useEffect(() => {
    if (wsConnected) {
      setIsOnline(true);
    }
  }, [wsConnected]);

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

  const restoreSession = useCallback(async () => {
    setSessionReconnectError(null);
    await initApiConfig();
    apiFetch<{ iceServers: RTCIceServer[] }>('/api/rtc-config')
      .then((res) => {
        if (Array.isArray(res.iceServers) && res.iceServers.length > 0) {
          iceServersRef.current = res.iceServers;
        }
      })
      .catch(() => {});

    try {
      const res = await apiFetch<{ user: SelfUser; token?: string }>('/api/users/me', {
        maxRetries: 4,
      });
      if (res.token) {
        setAuthToken(res.token);
      }
      setSessionReconnectError(null);
      setUser(res.user);
      setLanguage(res.user.language || detectDeviceLanguage());
    } catch (err) {
      if (err instanceof ApiRequestError && err.sessionInvalid) {
        clearNativeSessionAuth();
        setAuthToken(null);
        setSessionReconnectError(null);
      } else if (getAuthToken()) {
        setSessionReconnectError(
          err instanceof Error ? err.message : 'Unable to reach EASY CALL server.'
        );
      }
    } finally {
      setBooting(false);
    }
  }, []);

  // Load ICE servers & attempt persistent session restore on launch
  useEffect(() => {
    void restoreSession();
  }, [restoreSession]);

  // If launch hit a temporary network / cold-start timeout while token is saved, auto-retry on resume
  useEffect(() => {
    if (user || !sessionReconnectError) return;
    const retry = () => {
      if (getAuthToken()) {
        void restoreSession();
      }
    };
    window.addEventListener('online', retry);
    window.addEventListener('easycall:resume', retry);
    window.addEventListener('focus', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('easycall:resume', retry);
      window.removeEventListener('focus', retry);
    };
  }, [user, sessionReconnectError, restoreSession]);

  const refreshAllData = useCallback(async () => {
    if (!user) return;
    try {
      const [feedRes, friendsRes, callRes, notifRes, reqRes] = await Promise.all([
        apiFetch<{ items: HomeFeedItem[] }>('/api/home-feed'),
        apiFetch<{ friends: PublicUser[] }>('/api/friends'),
        apiFetch<{ calls: CallRecordItem[] }>('/api/calls'),
        apiFetch<{ notifications: AppNotification[] }>('/api/notifications'),
        apiFetch<{ incoming: FriendRequestItem[]; outgoing?: FriendRequestItem[] }>('/api/friend-requests'),
      ]);
      setHomeFeed(feedRes.items || []);
      setFriendsList(friendsRes.friends || []);
      setCalls(callRes.calls || []);
      setNotifications(notifRes.notifications || []);
      setIncomingRequests(reqRes.incoming || []);
      setOutgoingRequests(reqRes.outgoing || []);
    } catch {
      // Ignore transient refresh failure
    }
  }, [user]);

  const respondFriendRequest = useCallback(
    async (requestId: string, action: 'accept' | 'reject') => {
      await apiFetch(`/api/friend-requests/${encodeURIComponent(requestId)}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      setIncomingRequests((prev) => prev.filter((r) => r.requestId !== requestId));
      await refreshAllData();
    },
    [refreshAllData]
  );

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    cameraOffRef.current = cameraOff;
  }, [cameraOff]);

  useEffect(() => {
    speakerOnRef.current = speakerOn;
  }, [speakerOn]);

  useEffect(() => {
    dataSaverRef.current = Boolean(user?.dataSaver);
  }, [user?.dataSaver]);

  useEffect(() => {
    if (user) {
      refreshAllData();
      const activeTok = getAuthToken();
      if (activeTok) {
        syncNativeSessionAuth(resolveApiUrl(''), activeTok, user.id);
      }
      setNativeRingtone(getSelectedRingtoneId());
      if (hasNativeAndroidBridge() && contactsSyncedUserIdRef.current !== user.id) {
        const nums = getNativeDeviceContacts();
        if (nums.length > 0) {
          contactsSyncedUserIdRef.current = user.id;
          apiFetch('/api/contacts/match', {
            method: 'POST',
            body: JSON.stringify({ numbers: nums }),
          })
            .then(() => refreshAllData())
            .catch(() => {
              contactsSyncedUserIdRef.current = null;
            });
        }
      }
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
      contactsSyncedUserIdRef.current = null;
      setIsAdminEligible(false);
    }
  }, [user, refreshAllData]);

  const checkPendingIncomingCall = useCallback(async () => {
    if (!user) return;
    const nativeAcceptId = consumeNativePendingAcceptCallId();
    if (nativeAcceptId) {
      pendingAcceptCallIdRef.current = nativeAcceptId;
    }

    if (callSessionRef.current) {
      if (
        pendingAcceptCallIdRef.current &&
        callSessionRef.current.callId === pendingAcceptCallIdRef.current &&
        callSessionRef.current.direction === 'incoming' &&
        callSessionRef.current.phase === 'ringing'
      ) {
        pendingAcceptCallIdRef.current = null;
        void acceptIncomingCallRef.current(callSessionRef.current);
      }
      return;
    }

    try {
      const res = await apiFetch<{
        incoming: {
          callId: string;
          callType: 'audio' | 'video';
          startedAt: number;
          caller: PublicUser;
        } | null;
      }>('/api/calls/active-incoming');
      if (res.incoming && !callSessionRef.current) {
        const inc = res.incoming;
        const shouldAutoAccept = pendingAcceptCallIdRef.current === inc.callId;
        if (shouldAutoAccept) {
          pendingAcceptCallIdRef.current = null;
        }
        if (!hasNativeAndroidBridge() && !shouldAutoAccept) {
          ringtone.startIncoming();
        }
        const nextSession: ActiveCallSession = {
          callId: inc.callId,
          direction: 'incoming',
          callType: inc.callType,
          peer: inc.caller,
          phase: shouldAutoAccept ? 'connecting' : 'ringing',
          startedAt: inc.startedAt || Date.now(),
        };
        callSessionRef.current = nextSession;
        setCallSession(nextSession);
        if (shouldAutoAccept) {
          void acceptIncomingCallRef.current(nextSession);
        }
      }
    } catch {
      // Ignore transient check errors
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    checkPendingIncomingCall();

    const verifyWsLiveness = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnectWsRef.current?.();
        return;
      }
      const probeSentAt = Date.now();
      try {
        ws.send(JSON.stringify({ type: 'ping' }));
      } catch {
        reconnectWsRef.current?.();
        return;
      }
      if (pongCheckTimerRef.current !== null) {
        window.clearTimeout(pongCheckTimerRef.current);
      }
      pongCheckTimerRef.current = window.setTimeout(() => {
        pongCheckTimerRef.current = null;
        if (lastPongAtRef.current < probeSentAt) {
          reconnectWsRef.current?.();
        }
      }, 1200);
    };

    const onNativeAction = (ev: Event) => {
      const detail = (ev as CustomEvent<{ action?: string; callId?: string }>).detail;
      if (detail?.action === 'accept' && detail.callId) {
        pendingAcceptCallIdRef.current = detail.callId;
        verifyWsLiveness();
        checkPendingIncomingCall();
      }
    };

    const onVisibleOrResume = () => {
      if (document.visibilityState !== 'hidden') {
        verifyWsLiveness();
        refreshAllData();
        checkPendingIncomingCall();
      }
    };

    window.addEventListener('easycall:native-action', onNativeAction);
    window.addEventListener('easycall:resume', onVisibleOrResume);
    document.addEventListener('visibilitychange', onVisibleOrResume);
    return () => {
      window.removeEventListener('easycall:native-action', onNativeAction);
      window.removeEventListener('easycall:resume', onVisibleOrResume);
      document.removeEventListener('visibilitychange', onVisibleOrResume);
    };
  }, [user, refreshAllData, checkPendingIncomingCall]);

  const cleanupCallMedia = useCallback(() => {
    ringtone.stop();
    stopNativeRinging();
    setNativeCallAudioMode(false, false);
    if (relayFallbackTimerRef.current !== null) {
      window.clearTimeout(relayFallbackTimerRef.current);
      relayFallbackTimerRef.current = null;
    }
    if (relayRef.current) {
      relayRef.current.stop();
      relayRef.current = null;
    }
    relayActiveRef.current = false;
    setRelayActive(false);
    pendingOutIceRef.current = [];
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
    callSessionRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setRelayVideoFrame(null);
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
            sampleRate: 48000,
            channelCount: 1,
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

  const activateMediaRelay = useCallback(
    (callId: string, targetUserId: string, callType: 'audio' | 'video', notifyPeer = true) => {
      if (relayActiveRef.current || !callSessionRef.current || callSessionRef.current.callId !== callId) {
        return;
      }
      relayActiveRef.current = true;
      setRelayActive(true);
      if (relayFallbackTimerRef.current !== null) {
        window.clearTimeout(relayFallbackTimerRef.current);
        relayFallbackTimerRef.current = null;
      }
      ringtone.stop();
      stopNativeRinging();
      setNativeCallAudioMode(true, speakerOnRef.current);

      if (notifyPeer && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'relay:activate',
            callId,
            targetUserId,
          })
        );
      }

      const relay = new WssMediaRelay();
      relayRef.current = relay;
      relay.start({
        localStream: localStreamRef.current,
        isVideo: callType === 'video',
        dataSaver: dataSaverRef.current,
        isMuted: () => mutedRef.current,
        isCameraOff: () => cameraOffRef.current,
        onSendAudio: (pcm, sr) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: 'relay:audio',
                callId,
                targetUserId,
                sr,
                pcm,
              })
            );
          }
        },
        onSendVideo: (jpg) => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: 'relay:video',
                callId,
                targetUserId,
                jpg,
              })
            );
          }
        },
      });
      if (!hasNativeAndroidBridge()) {
        relay.setOutputGain(speakerOnRef.current ? 1 : 0.45);
      }

      setCallSession((prev) =>
        prev && prev.callId === callId && prev.phase !== 'connected'
          ? { ...prev, phase: 'connected' }
          : prev
      );
    },
    []
  );

  const scheduleRelayFallback = useCallback(
    (callId: string, targetUserId: string, callType: 'audio' | 'video') => {
      if (relayFallbackTimerRef.current !== null) {
        window.clearTimeout(relayFallbackTimerRef.current);
      }
      relayFallbackTimerRef.current = window.setTimeout(async () => {
        relayFallbackTimerRef.current = null;
        if (callSessionRef.current?.callId !== callId || relayActiveRef.current) return;
        const pc = pcRef.current;
        const p2pConnected =
          pc &&
          (pc.connectionState === 'connected' ||
            pc.iceConnectionState === 'connected' ||
            pc.iceConnectionState === 'completed');

        if (!p2pConnected) {
          activateMediaRelay(callId, targetUserId, callType, true);
          return;
        }

        // Verify actual RTP packets are flowing over P2P (some CGNAT routers report connected then blackhole UDP or drop video RTP)
        try {
          let inboundAudioBytes = 0;
          let inboundVideoBytes = 0;
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (report.type === 'inbound-rtp') {
              if (report.kind === 'audio') {
                inboundAudioBytes += Number(report.bytesReceived || 0);
              } else if (report.kind === 'video') {
                inboundVideoBytes += Number(report.bytesReceived || 0);
              }
            }
          });
          if (
            callSessionRef.current?.callId === callId &&
            (inboundAudioBytes === 0 || (callType === 'video' && inboundVideoBytes === 0))
          ) {
            activateMediaRelay(callId, targetUserId, callType, true);
          }
        } catch {
          // Ignore stats errors
        }
      }, 4200);
    },
    [activateMediaRelay]
  );

  const createPeerConnection = useCallback(
    (callId: string, targetUserId: string, callType: 'audio' | 'video', isCaller: boolean) => {
      const pc = new RTCPeerConnection({
        iceServers: iceServersRef.current,
        iceCandidatePoolSize: 4,
      });
      const rStream = new MediaStream();
      remoteStreamRef.current = rStream;
      setRemoteStream(rStream);

      const hasLocalAudio = Boolean(localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0);
      const hasLocalVideo = Boolean(localStreamRef.current && localStreamRef.current.getVideoTracks().length > 0);
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          pc.addTrack(track, localStreamRef.current);
        }
      }
      if (!hasLocalAudio) {
        try {
          pc.addTransceiver('audio', { direction: 'recvonly' });
        } catch {
          // Ignore if transceiver add unsupported
        }
      }
      if (callType === 'video' && !hasLocalVideo) {
        try {
          pc.addTransceiver('video', { direction: 'recvonly' });
        } catch {
          // Ignore if transceiver add unsupported
        }
      }

      pc.ontrack = (event) => {
        let changed = false;
        const existingIds = new Set(rStream.getTracks().map((t) => t.id));
        for (const stream of event.streams) {
          for (const track of stream.getTracks()) {
            if (!existingIds.has(track.id)) {
              rStream.addTrack(track);
              existingIds.add(track.id);
              changed = true;
            }
          }
        }
        if (event.track && !existingIds.has(event.track.id)) {
          rStream.addTrack(event.track);
          changed = true;
        }
        if (changed) {
          setRemoteStream(new MediaStream(rStream.getTracks()));
        }
      };

      pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        const cand = event.candidate.toJSON();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'webrtc:ice-candidate',
              callId,
              targetUserId,
              candidate: cand,
            })
          );
        } else {
          pendingOutIceRef.current.push({ callId, targetUserId, candidate: cand });
        }
      };

      const handleStateUpdate = () => {
        const connState = pc.connectionState;
        const iceState = pc.iceConnectionState;

        if (connState === 'connected' || iceState === 'completed' || (iceState === 'connected' && connState !== 'failed')) {
          ringtone.stop();
          stopNativeRinging();
          setNativeCallAudioMode(true, speakerOnRef.current);
          setCallSession((prev) => (prev ? { ...prev, phase: 'connected' } : prev));
        } else if (connState === 'failed' || iceState === 'failed' || iceState === 'disconnected') {
          if (!relayActiveRef.current) {
            activateMediaRelay(callId, targetUserId, callType, true);
          }
          if (isCaller && wsRef.current?.readyState === WebSocket.OPEN) {
            pc.createOffer({ iceRestart: true })
              .then(async (offer) => {
                await pc.setLocalDescription(offer);
                wsRef.current?.send(
                  JSON.stringify({
                    type: 'webrtc:offer',
                    callId,
                    targetUserId,
                    sdp: pc.localDescription,
                  })
                );
              })
              .catch(() => {});
          }
        }
      };

      pc.onconnectionstatechange = handleStateUpdate;
      pc.oniceconnectionstatechange = handleStateUpdate;

      pcRef.current = pc;
      return pc;
    },
    [activateMediaRelay]
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
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const prev = wsRef.current;
      if (prev && (prev.readyState === WebSocket.OPEN || prev.readyState === WebSocket.CONNECTING)) {
        try {
          prev.onclose = null;
          prev.close();
        } catch {
          // Ignore close errors
        }
      }
      const ws = new WebSocket(buildWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        lastPongAtRef.current = Date.now();
        if (!disposed) setWsConnected(true);
      };

      ws.onmessage = async (event) => {
        lastPongAtRef.current = Date.now();
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (msg.type === 'pong') {
          return;
        }

        if (msg.type === 'ws:ready') {
          setWsConnected(true);
          if (pendingOutIceRef.current.length > 0 && ws.readyState === WebSocket.OPEN) {
            const batch = pendingOutIceRef.current.splice(0);
            for (const item of batch) {
              ws.send(
                JSON.stringify({
                  type: 'webrtc:ice-candidate',
                  callId: item.callId,
                  targetUserId: item.targetUserId,
                  candidate: item.candidate,
                })
              );
            }
          }
          if (
            callSessionRef.current &&
            callSessionRef.current.callId !== 'pending' &&
            ws.readyState === WebSocket.OPEN
          ) {
            ws.send(
              JSON.stringify({
                type: 'call:sync',
                callId: callSessionRef.current.callId,
              })
            );
          }
        } else if (msg.type === 'presence:update') {
          const uid = String(msg.userId);
          const online = Boolean(msg.online);
          const lastSeenAt = Number(msg.lastSeenAt) || Date.now();
          setHomeFeed((prev) =>
            prev.map((item) =>
              item.peer.id === uid
                ? { ...item, peer: { ...item.peer, online, lastSeenAt } }
                : item
            )
          );
          setFriendsList((prev) =>
            prev.map((f) => (f.id === uid ? { ...f, online, lastSeenAt } : f))
          );
          setActiveChatFriend((prev) =>
            prev && prev.id === uid ? { ...prev, online, lastSeenAt } : prev
          );
        } else if (
          msg.type === 'friend_request:new' ||
          msg.type === 'friend_request:accepted' ||
          msg.type === 'friends:refresh' ||
          msg.type === 'notifications:refresh' ||
          msg.type === 'calls:refresh'
        ) {
          refreshAllData();
        } else if (msg.type === 'chat:message' && msg.message) {
          const m = msg.message as ChatMessage;
          setLiveMessages((prev) => [...prev, m]);
          refreshAllData();
        } else if (msg.type === 'call:created') {
          const callId = String(msg.callId);
          const deliveredNow = Boolean(msg.targetOnline);
          if (callSessionRef.current) {
            callSessionRef.current = {
              ...callSessionRef.current,
              callId,
              phase:
                callSessionRef.current.phase === 'calling' && deliveredNow
                  ? 'ringing'
                  : callSessionRef.current.phase,
            };
          }
          setCallSession((prev) =>
            prev
              ? {
                  ...prev,
                  callId,
                  phase: prev.phase === 'calling' && deliveredNow ? 'ringing' : prev.phase,
                }
              : prev
          );
        } else if (msg.type === 'call:ringing') {
          const callId = String(msg.callId);
          if (
            callSessionRef.current &&
            callSessionRef.current.callId === callId &&
            callSessionRef.current.phase === 'calling'
          ) {
            callSessionRef.current = { ...callSessionRef.current, phase: 'ringing' };
          }
          setCallSession((prev) =>
            prev && prev.callId === callId && prev.phase === 'calling'
              ? { ...prev, phase: 'ringing' }
              : prev
          );
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
            if (callSessionRef.current.callId !== callId) {
              ws.send(JSON.stringify({ type: 'call:reject', callId }));
            }
            return;
          }
          const shouldAutoAccept = pendingAcceptCallIdRef.current === callId;
          if (shouldAutoAccept) {
            pendingAcceptCallIdRef.current = null;
          } else {
            ringtone.startIncoming();
          }
          const nextSession: ActiveCallSession = {
            callId,
            direction: 'incoming',
            callType,
            peer: caller,
            phase: shouldAutoAccept ? 'connecting' : 'ringing',
            startedAt: Date.now(),
          };
          callSessionRef.current = nextSession;
          setCallSession(nextSession);
          if (shouldAutoAccept) {
            void acceptIncomingCallRef.current(nextSession);
          } else if ('Notification' in window && Notification.permission === 'granted') {
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
          stopNativeRinging();
          if (current.direction !== 'outgoing' || pcRef.current) return;
          setNativeCallAudioMode(true, speakerOnRef.current);
          setCallSession((prev) => (prev ? { ...prev, phase: 'connecting' } : prev));

          const pc = createPeerConnection(callId, current.peer.id, current.callType, true);
          scheduleRelayFallback(callId, current.peer.id, current.callType);
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
        } else if (msg.type === 'relay:activate') {
          const current = callSessionRef.current;
          if (current && current.callId === String(msg.callId) && !relayActiveRef.current) {
            activateMediaRelay(current.callId, current.peer.id, current.callType, false);
          }
        } else if (msg.type === 'relay:audio' && typeof msg.pcm === 'string') {
          const current = callSessionRef.current;
          if (current && current.callId === String(msg.callId)) {
            if (!relayActiveRef.current) {
              activateMediaRelay(current.callId, current.peer.id, current.callType, false);
            }
            relayRef.current?.playIncomingAudio(msg.pcm, Number(msg.sr) || 16000);
          }
        } else if (msg.type === 'relay:video' && typeof msg.jpg === 'string') {
          const current = callSessionRef.current;
          if (current && current.callId === String(msg.callId)) {
            if (!relayActiveRef.current) {
              activateMediaRelay(current.callId, current.peer.id, current.callType, false);
            }
            setRelayVideoFrame(msg.jpg);
          }
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          setWsConnected(false);
          reconnectTimer = window.setTimeout(connectWs, 1200);
        }
      };
    };

    reconnectWsRef.current = connectWs;
    connectWs();

    const pingInterval = window.setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, 15000);

    return () => {
      disposed = true;
      reconnectWsRef.current = null;
      setWsConnected(false);
      clearInterval(pingInterval);
      if (pongCheckTimerRef.current !== null) {
        clearTimeout(pongCheckTimerRef.current);
        pongCheckTimerRef.current = null;
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user, refreshAllData, cleanupCallMedia, createPeerConnection, activateMediaRelay, scheduleRelayFallback]);

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
      phase: 'calling',
      startedAt: Date.now(),
    };
    callSessionRef.current = sessionDraft;
    setCallSession(sessionDraft);
    ringtone.startOutgoing();
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const u = new AC();
      u.resume().finally(() => u.close().catch(() => {}));
    } catch {
      // Ignore AudioContext unlock errors
    }

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

  const acceptIncomingCall = useCallback(
    async (explicitSession?: ActiveCallSession) => {
      const current = explicitSession || callSessionRef.current;
      if (!current || pcRef.current) return;
      ringtone.stop();
      stopNativeRinging();
      setNativeCallAudioMode(true, speakerOnRef.current);
      try {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const u = new AC();
        u.resume().finally(() => u.close().catch(() => {}));
      } catch {
        // Ignore AudioContext unlock errors
      }
      const connectingSession: ActiveCallSession = { ...current, phase: 'connecting' };
      callSessionRef.current = connectingSession;
      setCallSession(connectingSession);

      // Immediately accept via BOTH WebSocket and HTTP so caller never misses acceptance
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'call:accept', callId: current.callId }));
      } else {
        reconnectWsRef.current?.();
      }
      apiFetch(`/api/calls/${encodeURIComponent(current.callId)}/accept`, {
        method: 'POST',
      }).catch(() => {});

      await acquireUserMedia(current.callType, 'user');
      if (!callSessionRef.current || callSessionRef.current.callId !== current.callId) {
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach((tr) => tr.stop());
          localStreamRef.current = null;
        }
        return;
      }

      const pc = createPeerConnection(current.callId, current.peer.id, current.callType, false);
      scheduleRelayFallback(current.callId, current.peer.id, current.callType);

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
      } else if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'call:sync', callId: current.callId }));
      }
    },
    [acquireUserMedia, createPeerConnection, scheduleRelayFallback]
  );

  useEffect(() => {
    acceptIncomingCallRef.current = acceptIncomingCall;
  }, [acceptIncomingCall]);

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
      if (relayActiveRef.current && relayRef.current && callSessionRef.current) {
        const cur = callSessionRef.current;
        relayRef.current.updateVideoStream(
          localStreamRef.current,
          cur.callType === 'video',
          dataSaverRef.current,
          () => cameraOffRef.current,
          (jpg) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: 'relay:video',
                  callId: cur.callId,
                  targetUserId: cur.peer.id,
                  jpg,
                })
              );
            }
          }
        );
      }
    } catch {
      // Device may only have one camera
    }
  };

  const unreadNotifsCount = Math.max(
    notifications.filter((n) => !n.isRead).length,
    incomingRequests.length
  );

  const totalUnreadChats = useMemo(
    () => homeFeed.reduce((sum, item) => sum + (item.unreadCount || 0), 0),
    [homeFeed]
  );

  const totalMissedCalls = useMemo(
    () => homeFeed.reduce((sum, item) => sum + (item.missedCount || 0), 0),
    [homeFeed]
  );

  const openChatWithPeer = useCallback(
    (peer: PublicUser) => {
      setActiveChatFriend(peer);
      apiFetch('/api/calls/mark-seen', {
        method: 'POST',
        body: JSON.stringify({ peerId: peer.id }),
      })
        .then(() => refreshAllData())
        .catch(() => {});
    },
    [refreshAllData]
  );

  const openCallHistoryView = useCallback(() => {
    setSubPage('calls');
    apiFetch('/api/calls/mark-seen', {
      method: 'POST',
      body: JSON.stringify({}),
    })
      .then(() => refreshAllData())
      .catch(() => {});
  }, [refreshAllData]);

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950">
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

  if (!user && sessionReconnectError && getAuthToken()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950 px-6">
        <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center shadow-lg">
          <img
            src="/easycall-logo.png"
            alt="EASY CALL"
            className="mx-auto h-14 w-14 rounded-full object-cover shadow"
          />
          <h2 className="mt-4 font-display text-lg font-bold text-slate-900 dark:text-white">
            EASY CALL
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            {sessionReconnectError}
          </p>
          <button
            type="button"
            onClick={() => {
              setBooting(true);
              void restoreSession();
            }}
            className="mt-5 w-full min-h-[44px] rounded-xl bg-[#1D8BF1] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1979D2]"
          >
            Reconnect Account
          </button>
          <button
            type="button"
            onClick={() => {
              clearNativeSessionAuth();
              setAuthToken(null);
              setSessionReconnectError(null);
            }}
            className="mt-2.5 w-full min-h-[40px] rounded-xl px-4 py-2 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            Switch Account / Sign Out
          </button>
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
          setSessionReconnectError(null);
          setUser(u);
          if (u.language) setLanguage(u.language);
        }}
        onOpenAdmin={onOpenAdmin}
      />
    );
  }

  const chatBadgeCount =
    totalUnreadChats + totalMissedCalls > 0 ? totalUnreadChats + totalMissedCalls : unreadNotifsCount;

  return (
    <div className="min-h-screen bg-[#F3F4F6] dark:bg-slate-950 text-slate-900 dark:text-slate-100 pb-16">
      {/* Screenshot 1 & 3 Top Header: Left Avatar + Chats Tab + Contacts Tab */}
      <header className="sticky top-0 z-30 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 pt-safe">
        <div className="mx-auto flex h-14 max-w-3xl items-stretch px-3">
          {/* Left Profile Avatar -> Opens "Me" Screen (Screenshot 2) */}
          <div className="flex items-center pe-3 shrink-0">
            <button
              type="button"
              onClick={() => setMeOpen(true)}
              aria-label="Open Me & Settings"
              className="relative flex items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[#1D8BF1]"
            >
              <Avatar
                src={user.avatarUrl}
                name={user.displayName || user.phoneE164}
                size="xs"
              />
              <span
                title={wsConnected ? 'Connected' : 'Connecting'}
                className={`absolute -bottom-0.5 -end-0.5 h-2.5 w-2.5 rounded-full border-2 border-white dark:border-slate-900 ${
                  wsConnected ? 'bg-[#22C55E]' : 'bg-amber-400'
                }`}
              />
            </button>
          </div>

          {/* 2 Equal Tabs: Chats & Contacts */}
          <div className="grid flex-1 grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setSubPage(null);
                setActiveTab('home');
              }}
              aria-label={t('navHome')}
              className={`relative flex items-center justify-center min-h-[44px] border-b-[2.5px] transition-colors ${
                activeTab === 'home' && !subPage
                  ? 'border-[#1D8BF1] text-[#1D8BF1]'
                  : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <MessageCircle
                  className={`h-6 w-6 ${
                    activeTab === 'home' && !subPage ? 'fill-[#1D8BF1]/20' : ''
                  }`}
                />
                {chatBadgeCount > 0 && (
                  <span className="absolute -top-2 -end-3 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#22C55E] px-1 text-[10px] font-bold text-white border-2 border-white dark:border-slate-900">
                    {chatBadgeCount}
                  </span>
                )}
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                setSubPage(null);
                setActiveTab('contacts');
              }}
              aria-label="Contacts"
              className={`relative flex items-center justify-center min-h-[44px] border-b-[2.5px] transition-colors ${
                activeTab === 'contacts' || subPage !== null
                  ? 'border-[#1D8BF1] text-[#1D8BF1]'
                  : 'border-transparent text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Contact className="h-6 w-6" />
                {incomingRequests.length > 0 && (
                  <span className="absolute -top-2 -end-3 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#22C55E] px-1 text-[10px] font-bold text-white border-2 border-white dark:border-slate-900">
                    {incomingRequests.length}
                  </span>
                )}
              </div>
            </button>
          </div>
        </div>
      </header>

      {!isOnline && !wsConnected && (
        <div className="bg-amber-500 px-4 py-1.5 text-center text-xs font-semibold text-white">
          No internet connection detected. Calls require an active internet or mobile data network.
        </div>
      )}

      {callNotice && (
        <div className="mx-auto max-w-3xl px-3 pt-2">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/50 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-amber-900 dark:text-amber-200 shadow-xs">
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

      {/* Main Content Container */}
      <main className="mx-auto max-w-3xl shadow-xs">
        {subPage === 'calls' ? (
          <CallsTab
            language={language}
            calls={calls}
            onBack={() => setSubPage(null)}
            onPreviewPhoto={setPhotoPreview}
            onClearHistory={async () => {
              await apiFetch('/api/calls', { method: 'DELETE' }).catch(() => {});
              setCalls([]);
              refreshAllData();
            }}
            onCallback={startOutgoingCall}
          />
        ) : subPage === 'newContacts' ? (
          <ContactsPanel
            language={language}
            incomingRequests={incomingRequests}
            outgoingRequests={outgoingRequests}
            onBack={() => setSubPage(null)}
            onRefreshAll={refreshAllData}
            onOpenQrScanner={() => {
              setQrInitialTab('scan');
              setQrOpen(true);
            }}
          />
        ) : activeTab === 'contacts' ? (
          <ContactsTabView
            selfUser={user}
            language={language}
            friendsList={friendsList}
            homeFeed={homeFeed}
            incomingRequests={incomingRequests}
            unreadNotificationsCount={unreadNotifsCount}
            missedCallsCount={totalMissedCalls}
            searchOpen={searchOpen}
            onCloseSearch={() => setSearchOpen(false)}
            onOpenNewContacts={() => setSubPage('newContacts')}
            onOpenQrScanner={() => {
              setQrInitialTab('scan');
              setQrOpen(true);
            }}
            onOpenMyQr={() => {
              setQrInitialTab('my');
              setQrOpen(true);
            }}
            onOpenCallHistory={openCallHistoryView}
            onOpenNotifications={() => setNotificationsOpen(true)}
            onOpenChat={openChatWithPeer}
            onStartCall={startOutgoingCall}
            onRespondFriendRequest={respondFriendRequest}
            onPreviewPhoto={setPhotoPreview}
          />
        ) : (
          <HomeTab
            selfUser={user}
            language={language}
            homeFeed={homeFeed}
            recentCalls={calls}
            friendsList={friendsList}
            incomingRequests={incomingRequests}
            searchOpen={searchOpen}
            onCloseSearch={() => setSearchOpen(false)}
            onRespondFriendRequest={respondFriendRequest}
            onStartCall={startOutgoingCall}
            onOpenChat={openChatWithPeer}
            onOpenQrScanner={() => {
              setQrInitialTab('scan');
              setQrOpen(true);
            }}
            onOpenMe={() => setMeOpen(true)}
            onPreviewPhoto={setPhotoPreview}
          />
        )}
      </main>

      {/* Screenshot 1 & 3 Fixed Bottom Action Bar: + (left) and Search (right) */}
      {!subPage && (
        <footer className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-3">
            <button
              type="button"
              onClick={() => setQuickMenuOpen(true)}
              aria-label="Quick actions"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40"
            >
              <Plus className="h-7 w-7 stroke-[2]" />
            </button>

            <button
              type="button"
              onClick={() => setSearchOpen((prev) => !prev)}
              aria-label="Search"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40"
            >
              <Search className="h-6 w-6 stroke-[2]" />
            </button>
          </div>
        </footer>
      )}

      {/* Quick Actions Bottom Sheet (opened by Bottom-Left + Button) */}
      {quickMenuOpen && (
        <div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/45 backdrop-blur-xs"
          onClick={() => setQuickMenuOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl rounded-t-3xl bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 pb-safe shadow-2xl space-y-1"
          >
            <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
            <div className="flex items-center justify-between px-2 pb-2">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Quick Actions</p>
              <button
                type="button"
                onClick={() => setQuickMenuOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setQuickMenuOpen(false);
                setSubPage('newContacts');
              }}
              className="flex w-full min-h-[48px] items-center gap-3.5 rounded-xl px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-start"
            >
              <UserPlus className="h-5 w-5 text-[#1D8BF1]" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                New Contacts & Friend Requests
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setQuickMenuOpen(false);
                setQrInitialTab('scan');
                setQrOpen(true);
              }}
              className="flex w-full min-h-[48px] items-center gap-3.5 rounded-xl px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-start"
            >
              <ScanLine className="h-5 w-5 text-emerald-500" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {t('scanQrCode')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setQuickMenuOpen(false);
                setQrInitialTab('my');
                setQrOpen(true);
              }}
              className="flex w-full min-h-[48px] items-center gap-3.5 rounded-xl px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-start"
            >
              <QrCode className="h-5 w-5 text-amber-500" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                {t('myQrCode')}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setQuickMenuOpen(false);
                openCallHistoryView();
              }}
              className="flex w-full min-h-[48px] items-center gap-3.5 rounded-xl px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-start"
            >
              <PhoneCall className="h-5 w-5 text-[#1D8BF1]" />
              <span className="text-sm font-medium text-slate-900 dark:text-white">
                Call History
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setQuickMenuOpen(false);
                setNotificationsOpen(true);
              }}
              className="flex w-full min-h-[48px] items-center justify-between rounded-xl px-3 hover:bg-slate-50 dark:hover:bg-slate-800 text-start"
            >
              <span className="flex items-center gap-3.5">
                <Bell className="h-5 w-5 text-indigo-500" />
                <span className="text-sm font-medium text-slate-900 dark:text-white">
                  {t('notifications')}
                </span>
              </span>
              {unreadNotifsCount > 0 && (
                <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">
                  {unreadNotifsCount}
                </span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Screenshot 2 "Me" Full-Screen Profile, Settings & QR Screen */}
      <ProfileSettingsTab
        open={meOpen}
        selfUser={user}
        language={language}
        darkMode={darkMode}
        isAdminEligible={isAdminEligible}
        unreadNotificationsCount={unreadNotifsCount}
        onClose={() => setMeOpen(false)}
        onToggleDarkMode={() => setDarkMode((d) => !d)}
        onUserUpdated={(updated) => {
          setUser(updated);
          if (updated.language) setLanguage(updated.language);
        }}
        onOpenMyQr={() => {
          setQrInitialTab('my');
          setQrOpen(true);
        }}
        onOpenScanQr={() => {
          setQrInitialTab('scan');
          setQrOpen(true);
        }}
        onOpenNotifications={() => setNotificationsOpen(true)}
        onOpenAdmin={onOpenAdmin}
        onPreviewPhoto={setPhotoPreview}
        onLoggedOut={() => {
          cleanupCallMedia();
          clearNativeSessionAuth();
          setAuthToken(null);
          setMeOpen(false);
          setUser(null);
          setHomeFeed([]);
          setFriendsList([]);
          setCalls([]);
        }}
      />

      {/* Modals & Overlays */}
      <QrModal
        open={qrOpen}
        initialTab={qrInitialTab}
        selfUser={user}
        language={language}
        incomingRequests={incomingRequests}
        onRespondFriendRequest={respondFriendRequest}
        onClose={() => setQrOpen(false)}
        onRequestSent={refreshAllData}
      />

      <NotificationsDrawer
        open={notificationsOpen}
        language={language}
        notifications={notifications}
        incomingRequests={incomingRequests}
        onClose={() => setNotificationsOpen(false)}
        onMarkAllRead={async () => {
          await apiFetch('/api/notifications/read-all', { method: 'POST' }).catch(() => {});
          setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
        }}
        onRespondFriendRequest={respondFriendRequest}
      />

      <ChatDrawer
        friend={activeChatFriend}
        selfUser={user}
        language={language}
        incomingMessages={liveMessages}
        onClose={() => {
          setActiveChatFriend(null);
          refreshAllData();
        }}
        onStartCall={(f, type) => {
          setActiveChatFriend(null);
          startOutgoingCall(f, type);
        }}
        onPreviewPhoto={setPhotoPreview}
      />

      <PhotoViewerModal photo={photoPreview} onClose={() => setPhotoPreview(null)} />

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
        relayVideoFrame={relayVideoFrame}
        relayActive={relayActive}
        onAccept={() => acceptIncomingCall()}
        onReject={rejectIncomingCall}
        onEnd={endActiveCall}
        onToggleMute={toggleMute}
        onToggleCamera={toggleCamera}
        onFlipCamera={flipCamera}
        onToggleSpeaker={() => {
          setSpeakerOn((prev) => {
            const next = !prev;
            setNativeSpeakerphone(next);
            if (!hasNativeAndroidBridge()) {
              relayRef.current?.setOutputGain(next ? 1 : 0.45);
            }
            return next;
          });
        }}
      />
    </div>
  );
}
