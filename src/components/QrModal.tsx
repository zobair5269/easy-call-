import React, { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Camera, Check, Copy, QrCode, Search, Upload, UserPlus, X } from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch } from '../lib/api';
import type { FriendRequestItem, PublicUser, SelfUser } from '../types/app';
import { Avatar } from './Avatar';

interface QrModalProps {
  open: boolean;
  initialTab?: 'my' | 'scan';
  selfUser: SelfUser;
  language: string;
  incomingRequests?: FriendRequestItem[];
  onRespondFriendRequest?: (requestId: string, action: 'accept' | 'reject') => Promise<void> | void;
  onClose: () => void;
  onRequestSent: () => void;
}

export const QrModal: React.FC<QrModalProps> = ({
  open,
  initialTab = 'my',
  selfUser,
  language,
  incomingRequests = [],
  onRespondFriendRequest,
  onClose,
  onRequestSent,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [tab, setTab] = useState<'my' | 'scan'>(initialTab);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const [manualCode, setManualCode] = useState('');
  const [scannedUser, setScannedUser] = useState<PublicUser | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [sendingReq, setSendingReq] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setTab(initialTab);
    setScannedUser(null);
    setScanError(null);
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(`easycall://user/${selfUser.qrToken}`, {
      width: 320,
      margin: 2,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then(setQrDataUrl)
      .catch(() => {});
  }, [open, selfUser.qrToken]);

  const stopCamera = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  useEffect(() => {
    if (!open || tab !== 'scan') {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [open, tab]);

  const lookupQrToken = async (raw: string) => {
    setScanError(null);
    const cleaned = raw.replace(/^easycall:\/\/user\//i, '').trim();
    if (!cleaned) return;
    try {
      const res = await apiFetch<{ user: PublicUser }>(
        `/api/users/by-qr/${encodeURIComponent(cleaned)}`
      );
      setScannedUser(res.user);
      stopCamera();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'QR code not found.');
    }
  };

  const startCameraScan = async () => {
    setScanError(null);
    setScannedUser(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);

      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      });

      const scanFrame = () => {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!video || !canvas || !streamRef.current) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const decoded = jsQR(imgData.data, imgData.width, imgData.height);
            if (decoded && decoded.data) {
              lookupQrToken(decoded.data);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(scanFrame);
      };
      rafRef.current = requestAnimationFrame(scanFrame);
    } catch {
      setScanError('Camera permission unavailable. You can upload a QR image or enter the ID below.');
    }
  };

  const handleQrImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imgData.data, imgData.width, imgData.height);
        if (decoded?.data) {
          lookupQrToken(decoded.data);
        } else {
          setScanError('Could not detect a valid EASY CALL QR code in this image.');
        }
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSendFriendRequest = async (toUserId: string) => {
    setSendingReq(true);
    setScanError(null);
    try {
      await apiFetch('/api/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ toUserId }),
      });
      setScannedUser((prev) => (prev ? { ...prev, requestStatus: 'outgoing_pending' } : prev));
      onRequestSent();
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Unable to send friend request.');
    } finally {
      setSendingReq(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <QrCode className="h-5 w-5 text-teal-700 dark:text-teal-400" />
            {t('scanQr')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Segmented tabs */}
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
          <button
            type="button"
            onClick={() => setTab('my')}
            className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === 'my'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t('myQrCode')}
          </button>
          <button
            type="button"
            onClick={() => setTab('scan')}
            className={`min-h-[44px] rounded-xl text-sm font-semibold transition-colors whitespace-nowrap ${
              tab === 'scan'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t('scanQrCode')}
          </button>
        </div>

        {tab === 'my' && (
          <div className="mt-6 flex flex-col items-center text-center space-y-4">
            <Avatar src={selfUser.avatarUrl} name={selfUser.displayName || selfUser.phoneE164} size="lg" />
            <div>
              <p className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {selfUser.displayName || selfUser.phoneE164}
              </p>
              <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
                {selfUser.qrToken}
              </p>
            </div>

            {qrDataUrl && (
              <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white p-4 shadow-sm">
                <img
                  src={qrDataUrl}
                  alt="Personal EASY CALL QR code"
                  className="h-56 w-56 object-contain"
                />
              </div>
            )}

            <p className="text-sm text-slate-600 dark:text-slate-300 max-w-xs">
              {t('qrInstruction')}
            </p>

            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(selfUser.qrToken).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {copied ? <Check className="h-4 w-4 text-teal-600" /> : <Copy className="h-4 w-4" />}
              {copied ? t('savedNotice') : selfUser.qrToken}
            </button>
          </div>
        )}

        {tab === 'scan' && (
          <div className="mt-5 space-y-4">
            {cameraActive ? (
              <div className="relative overflow-hidden rounded-2xl border border-slate-300 dark:border-slate-700 bg-black aspect-square">
                <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
                <canvas ref={canvasRef} className="hidden" />
                <button
                  type="button"
                  onClick={stopCamera}
                  className="absolute bottom-3 inset-x-3 min-h-[44px] rounded-xl bg-slate-900/80 text-sm font-semibold text-white backdrop-blur-sm"
                >
                  Stop Camera
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={startCameraScan}
                  className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800 transition-colors"
                >
                  <Camera className="h-4 w-4 shrink-0" />
                  <span className="truncate">Camera Scan</span>
                </button>
                <label className="flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors">
                  <Upload className="h-4 w-4 shrink-0" />
                  <span className="truncate">QR Image</span>
                  <input type="file" accept="image/*" onChange={handleQrImageUpload} className="hidden" />
                </label>
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                lookupQrToken(manualCode);
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder={t('enterQrManually')}
                className="flex-1 min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 font-mono text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
              />
              <button
                type="submit"
                className="min-h-[48px] rounded-xl bg-slate-900 dark:bg-slate-700 px-4 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0 flex items-center gap-1.5"
              >
                <Search className="h-4 w-4" />
                {t('lookupQr')}
              </button>
            </form>

            {scanError && (
              <p className="rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                {scanError}
              </p>
            )}

            {scannedUser && (
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={scannedUser.avatarUrl} name={scannedUser.displayName} size="md" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                      {scannedUser.displayName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {scannedUser.countryIso} · {scannedUser.qrToken}
                    </p>
                  </div>
                </div>

                {scannedUser.isFriend ? (
                  <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 whitespace-nowrap">
                    Friend
                  </span>
                ) : scannedUser.requestStatus === 'outgoing_pending' ? (
                  <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
                    {t('requestSent')}
                  </span>
                ) : scannedUser.requestStatus === 'incoming_pending' ? (
                  (() => {
                    const pendingReq = incomingRequests.find((r) => r.user.id === scannedUser.id);
                    if (pendingReq && onRespondFriendRequest) {
                      return (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            disabled={sendingReq}
                            onClick={async () => {
                              setSendingReq(true);
                              try {
                                await onRespondFriendRequest(pendingReq.requestId, 'accept');
                                setScannedUser((prev) =>
                                  prev ? { ...prev, isFriend: true, requestStatus: 'accepted' } : prev
                                );
                              } finally {
                                setSendingReq(false);
                              }
                            }}
                            className="inline-flex min-h-[40px] items-center gap-1 rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {t('acceptRequest')}
                          </button>
                          <button
                            type="button"
                            disabled={sendingReq}
                            onClick={async () => {
                              setSendingReq(true);
                              try {
                                await onRespondFriendRequest(pendingReq.requestId, 'reject');
                                setScannedUser((prev) =>
                                  prev ? { ...prev, isFriend: false, requestStatus: 'none' } : prev
                                );
                              } finally {
                                setSendingReq(false);
                              }
                            }}
                            className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
                          >
                            <X className="h-3.5 w-3.5" />
                            {t('rejectRequest')}
                          </button>
                        </div>
                      );
                    }
                    return (
                      <span className="text-xs font-semibold text-teal-700 dark:text-teal-400 whitespace-nowrap">
                        {t('friendRequests')}
                      </span>
                    );
                  })()
                ) : (
                  <button
                    type="button"
                    disabled={sendingReq}
                    onClick={() => handleSendFriendRequest(scannedUser.id)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 whitespace-nowrap shrink-0"
                  >
                    <UserPlus className="h-4 w-4" />
                    {t('sendRequest')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
