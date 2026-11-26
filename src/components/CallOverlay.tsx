import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  RefreshCw,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { hasNativeAndroidBridge } from '../lib/nativeBridge';
import type { PublicUser } from '../types/app';
import { Avatar } from './Avatar';

export interface ActiveCallSession {
  callId: string;
  direction: 'incoming' | 'outgoing';
  callType: 'audio' | 'video';
  peer: PublicUser;
  phase: 'ringing' | 'connecting' | 'connected' | 'reconnecting';
  startedAt: number;
}

interface CallOverlayProps {
  language: string;
  session: ActiveCallSession | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  cameraOff: boolean;
  speakerOn: boolean;
  dataSaver: boolean;
  durationSec: number;
  mediaError: string | null;
  relayVideoFrame?: string | null;
  relayActive?: boolean;
  onAccept: () => void;
  onReject: () => void;
  onEnd: () => void;
  onToggleMute: () => void;
  onToggleCamera: () => void;
  onFlipCamera: () => void;
  onToggleSpeaker: () => void;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  language,
  session,
  localStream,
  remoteStream,
  muted,
  cameraOff,
  speakerOn,
  dataSaver,
  durationSec,
  mediaError,
  relayVideoFrame,
  relayActive = false,
  onAccept,
  onReject,
  onEnd,
  onToggleMute,
  onToggleCamera,
  onFlipCamera,
  onToggleSpeaker,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [webrtcVideoReady, setWebrtcVideoReady] = useState(false);
  const isNative = hasNativeAndroidBridge();

  useEffect(() => {
    setWebrtcVideoReady(false);
  }, [session?.callId, remoteStream]);

  useEffect(() => {
    const syncRemotePlayback = () => {
      if (remoteVideoRef.current && remoteStream) {
        if (remoteVideoRef.current.srcObject !== remoteStream) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        remoteVideoRef.current.muted = true;
        remoteVideoRef.current.play().catch(() => {});
        if (remoteVideoRef.current.videoWidth > 0 && remoteVideoRef.current.videoHeight > 0) {
          setWebrtcVideoReady(true);
        }
      }
      if (remoteAudioRef.current && remoteStream) {
        if (remoteAudioRef.current.srcObject !== remoteStream) {
          remoteAudioRef.current.srcObject = remoteStream;
        }
        remoteAudioRef.current.muted = relayActive;
        remoteAudioRef.current.volume = isNative ? 1 : speakerOn ? 1 : 0.45;
        if (!relayActive) {
          remoteAudioRef.current.play().catch(() => {});
        }
      }
    };

    syncRemotePlayback();
    if (!remoteStream) return;

    remoteStream.addEventListener('addtrack', syncRemotePlayback);
    return () => {
      remoteStream.removeEventListener('addtrack', syncRemotePlayback);
    };
  }, [remoteStream, speakerOn, session?.callId, isNative, relayActive, relayVideoFrame]);

  useEffect(() => {
    if (localVideoRef.current && localStream && !cameraOff) {
      if (localVideoRef.current.srcObject !== localStream) {
        localVideoRef.current.srcObject = localStream;
      }
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream, session?.callId, cameraOff]);

  if (!session) return null;

  const isVideo = session.callType === 'video';
  const hasWebRtcVideo = Boolean(remoteStream && remoteStream.getVideoTracks().length > 0);
  const showRelayVideo = isVideo && Boolean(relayVideoFrame) && (relayActive || !webrtcVideoReady);
  const showWebRtcVideo = isVideo && hasWebRtcVideo && !showRelayVideo;
  const hasRemoteVideo = showRelayVideo || (showWebRtcVideo && webrtcVideoReady);
  const statusLabel =
    session.phase === 'ringing'
      ? session.direction === 'incoming'
        ? t('incomingCall')
        : t('outgoingCall')
      : session.phase === 'connecting'
        ? t('connecting')
        : session.phase === 'reconnecting'
          ? t('reconnecting')
          : formatDuration(durationSec);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-between bg-slate-950 text-white">
      <audio
        ref={remoteAudioRef}
        autoPlay
        playsInline
        className="sr-only"
      />

      {/* Remote Video Background (prefer WSS relay frames whenever relay is active or WebRTC has no decoded video yet) */}
      {showRelayVideo && relayVideoFrame ? (
        <img
          src={relayVideoFrame}
          alt={session.peer.displayName}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : showWebRtcVideo ? (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted
          onLoadedData={() => {
            if (remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0) {
              setWebrtcVideoReady(true);
            }
          }}
          onPlaying={() => {
            if (remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0) {
              setWebrtcVideoReady(true);
            }
          }}
          onResize={() => {
            if (remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0) {
              setWebrtcVideoReady(true);
            }
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}

      {/* Contrast Scrim */}
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/80 via-slate-950/35 to-slate-950/90 pointer-events-none" />

      {/* Top Status & Peer Info */}
      <div className="relative z-10 flex flex-col items-center pt-10 px-6 text-center">
        <div className="flex items-center gap-2 text-xs font-medium text-teal-300">
          <Wifi className="h-4 w-4" />
          <span>{session.phase === 'connected' ? t('connected') : statusLabel}</span>
          {dataSaver && (
            <>
              <span aria-hidden="true">·</span>
              <span>{t('dataSaverActive')}</span>
            </>
          )}
        </div>

        <div className="mt-6 flex flex-col items-center gap-3">
          {(!isVideo || session.phase !== 'connected' || !hasRemoteVideo) && (
            <Avatar src={session.peer.avatarUrl} name={session.peer.displayName} size="xl" />
          )}
          <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-white">
            {session.peer.displayName}
          </h2>
          <p className="font-mono text-lg text-slate-200 tabular-nums">{statusLabel}</p>
          {mediaError && (
            <p className="mt-2 max-w-sm rounded-xl bg-amber-500/20 border border-amber-400/40 px-4 py-2 text-xs text-amber-100">
              {mediaError}
            </p>
          )}
        </div>
      </div>

      {/* Local PiP Camera Preview */}
      {isVideo && localStream && !cameraOff && (
        <div className="relative z-10 self-end mx-6 my-4 h-40 w-28 sm:h-48 sm:w-36 overflow-hidden rounded-2xl border-2 border-white/25 bg-slate-900 shadow-2xl">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover"
          />
        </div>
      )}

      {/* Bottom Ergonomic Controls */}
      <div className="relative z-10 pb-10 px-6">
        {session.direction === 'incoming' && session.phase === 'ringing' ? (
          <div className="mx-auto flex max-w-sm items-center justify-around gap-6">
            <button
              type="button"
              onClick={onReject}
              className="flex flex-col items-center gap-2"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose-600 text-white shadow-lg hover:bg-rose-700 transition-colors">
                <PhoneOff className="h-7 w-7" />
              </span>
              <span className="text-sm font-semibold text-white">{t('reject')}</span>
            </button>

            <button
              type="button"
              onClick={onAccept}
              className="flex flex-col items-center gap-2"
            >
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-700 transition-colors">
                <Phone className="h-7 w-7" />
              </span>
              <span className="text-sm font-semibold text-white">{t('accept')}</span>
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-lg flex-col items-center gap-6">
            <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
              <button
                type="button"
                onClick={onToggleMute}
                className="flex flex-col items-center gap-1.5 min-w-[64px]"
              >
                <span
                  className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                    muted ? 'bg-white text-slate-900' : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
                </span>
                <span className="text-xs font-medium text-slate-200">
                  {muted ? t('unmute') : t('mute')}
                </span>
              </button>

              <button
                type="button"
                onClick={onToggleSpeaker}
                className="flex flex-col items-center gap-1.5 min-w-[64px]"
              >
                <span
                  className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                    !speakerOn ? 'bg-white text-slate-900' : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  {speakerOn ? <Volume2 className="h-6 w-6" /> : <VolumeX className="h-6 w-6" />}
                </span>
                <span className="text-xs font-medium text-slate-200">{t('speaker')}</span>
              </button>

              {isVideo && (
                <>
                  <button
                    type="button"
                    onClick={onToggleCamera}
                    className="flex flex-col items-center gap-1.5 min-w-[64px]"
                  >
                    <span
                      className={`flex h-14 w-14 items-center justify-center rounded-full transition-colors ${
                        cameraOff
                          ? 'bg-white text-slate-900'
                          : 'bg-white/15 text-white hover:bg-white/25'
                      }`}
                    >
                      {cameraOff ? <CameraOff className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
                    </span>
                    <span className="text-xs font-medium text-slate-200">
                      {cameraOff ? t('cameraOn') : t('cameraOff')}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={onFlipCamera}
                    className="flex flex-col items-center gap-1.5 min-w-[64px]"
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors">
                      <RefreshCw className="h-6 w-6" />
                    </span>
                    <span className="text-xs font-medium text-slate-200">{t('flipCamera')}</span>
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={onEnd}
              className="flex min-h-[56px] min-w-[180px] items-center justify-center gap-2.5 rounded-full bg-rose-600 px-8 py-3.5 text-base font-semibold text-white shadow-xl hover:bg-rose-700 transition-colors"
            >
              <PhoneOff className="h-6 w-6" />
              {t('endCall')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
