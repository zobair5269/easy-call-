import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Download, Home, Moon, PhoneCall, Settings, Sun } from 'lucide-react';
import { AdminBuilderPage } from './components/AdminBuilderPage';
import { Avatar } from './components/Avatar';
import { CallOverlay, type ActiveCallSession } from './components/CallOverlay';
import { CallsTab } from './components/CallsTab';
import { ChatDrawer } from './components/ChatDrawer';
import { HomeTab } from './components/HomeTab';
import { NotificationsDrawer } from './components/NotificationsDrawer';
import { ProfileSettingsTab } from './components/ProfileSettingsTab';
import { QrModal } from './components/QrModal';
import { WelcomeAuth } from './components/WelcomeAuth';
import { detectDeviceLanguage, getLanguageMeta, translate, type TranslationKeys } from './i18n/translations';
import { apiFetch, buildWsUrl, getAuthToken, initApiConfig, resolveApiUrl, setAuthToken } from './lib/api';
import {
  clearNativeSessionAuth,
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
  const [user, setUser] = useState<SelfUser | null>(null);
  const [isAdminEligible, setIsAdminEligible] = useState(false);
  const [language, setLanguage] = useState<string>(() => detectDeviceLanguage());
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('home');
  const [homeFeed, setHomeFeed] = useState<HomeFeedItem[]>([]);
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
  const relayRef = useRef<WssMediaRelay | null>(null);
  const relayFallbackTimerRef = useRef<number | null>(null);
  const relayActiveRef = useRef(false);
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
      const [feedRes, callRes, notifRes] = await Promise.all([
        apiFetch<{ items: HomeFeedItem[] }>('/api/home-feed'),
        apiFetch<{ calls: CallRecordItem[] }>('/api/calls'),
        apiFetch<{ notifications: AppNotification[] }>('/api/notifications'),
      ]);
      setHomeFeed(feedRes.items || []);
      setCalls(callRes.calls || []);
      setNotifications(notifRes.notifications || []);
    } catch {
      // Ignore transient refresh failure
    }
  }, [user]);

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
      syncNativeSessionAuth(resolveApiUrl(''), getAuthToken() || '', user.id);
      setNativeRingtone(getSelectedRingtoneId());
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

  const checkPendingIncomingCall = useCallback(async () => {
    if (!user || callSessionRef.current) return;
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
        if (!hasNativeAndroidBridge()) {
          ringtone.startIncoming();
        }
        const nextSession: ActiveCallSession = {
          callId: inc.callId,
          direction: 'incoming',
          callType: inc.callType,
          peer: inc.caller,
          phase: 'ringing',
          startedAt: inc.startedAt || Date.now(),
        };
        callSessionRef.current = nextSession;
        setCallSession(nextSession);
      }
    } catch {
      // Ignore transient check errors
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    checkPendingIncomingCall();
    const onVisibleOrResume = () => {
      if (document.visibilityState !== 'hidden') {
        refreshAllData();
        checkPendingIncomingCall();
      }
    };
    window.addEventListener('easycall:resume', onVisibleOrResume);
    document.addEventListener('visibilitychange', onVisibleOrResume);
    return () => {
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

        // Verify actual RTP packets are flowing over P2P (some CGNAT routers report connected then blackhole UDP)
        try {
          let inboundBytes = 0;
          const stats = await pc.getStats();
          stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && report.kind === 'audio') {
              inboundBytes += Number(report.bytesReceived || 0);
            }
          });
          if (inboundBytes === 0 && callSessionRef.current?.callId === callId) {
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
        } else if (msg.type === 'presence:update') {
          const uid = String(msg.userId);
          const online = Boolean(msg.online);
          setHomeFeed((prev) =>
            prev.map((item) =>
              item.peer.id === uid ? { ...item, peer: { ...item.peer, online } } : item
            )
          );
        } else if (msg.type === 'friend_request:new' || msg.type === 'friend_request:accepted' || msg.type === 'friends:refresh' || msg.type === 'notifications:refresh') {
          refreshAllData();
        } else if (msg.type === 'chat:message' && msg.message) {
          const m = msg.message as ChatMessage;
          setLiveMessages((prev) => [...prev, m]);
          refreshAllData();
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
            if (callSessionRef.current.callId !== callId) {
              ws.send(JSON.stringify({ type: 'call:reject', callId }));
            }
            return;
          }
          ringtone.startIncoming();
          const nextSession: ActiveCallSession = {
            callId,
            direction: 'incoming',
            callType,
            peer: caller,
            phase: 'ringing',
            startedAt: Date.now(),
          };
          callSessionRef.current = nextSession;
          setCallSession(nextSession);
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
          stopNativeRinging();
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
      phase: 'ringing',
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

  const acceptIncomingCall = async () => {
    const current = callSessionRef.current;
    if (!current) return;
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

          {/* Desktop Nav Links (Clean imo-style 3 tabs: Home, Calls, Settings) */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-300">
            {(
              [
                ['home', t('navHome')],
                ['calls', t('navCalls')],
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

      {!isOnline && !wsConnected && (
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
            homeFeed={homeFeed}
            recentCalls={calls}
            onStartCall={startOutgoingCall}
            onOpenChat={(f) => setActiveChatFriend(f)}
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
              refreshAllData();
            }}
            onCallback={startOutgoingCall}
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
              clearNativeSessionAuth();
              setAuthToken(null);
              setUser(null);
              setHomeFeed([]);
              setCalls([]);
            }}
          />
        )}
      </main>

      {/* Mobile Fixed Bottom Thumb Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md pb-safe">
        <div className="grid grid-cols-3 h-16 items-center">
          {(
            [
              ['home', t('navHome'), Home],
              ['calls', t('navCalls'), PhoneCall],
              ['settings', t('navSettings'), Settings],
            ] as const
          ).map(([key, label, Icon]) => {
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
        onClose={() => {
          setActiveChatFriend(null);
          refreshAllData();
        }}
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
        relayVideoFrame={relayVideoFrame}
        onAccept={acceptIncomingCall}
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
