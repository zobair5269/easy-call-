import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowLeftRight,
  Bell,
  Camera,
  Check,
  ChevronRight,
  Download,
  Globe,
  KeyRound,
  LogOut,
  Moon,
  Music,
  QrCode,
  ScanLine,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Square,
  Sun,
  Trash2,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import { SUPPORTED_LANGUAGES, translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch, fileToCompressedDataUrl } from '../lib/api';
import {
  getSelectedRingtoneId,
  ringtone,
  ROMANTIC_RINGTONES,
  setSelectedRingtoneId,
  type RomanticRingtoneId,
} from '../lib/ringtone';
import type { PublicUser, SelfUser } from '../types/app';
import { Avatar } from './Avatar';
import type { PhotoViewerTarget } from './PhotoViewerModal';
import { PWAInstallButton } from './PWAInstallButton';

interface ProfileSettingsTabProps {
  open: boolean;
  selfUser: SelfUser;
  language: string;
  darkMode: boolean;
  isAdminEligible: boolean;
  unreadNotificationsCount: number;
  onClose: () => void;
  onToggleDarkMode: () => void;
  onUserUpdated: (user: SelfUser) => void;
  onOpenMyQr: () => void;
  onOpenScanQr: () => void;
  onOpenNotifications: () => void;
  onOpenAdmin: () => void;
  onLoggedOut: () => void;
  onPreviewPhoto: (target: PhotoViewerTarget) => void;
}

type MeSubView = 'menu' | 'edit' | 'security' | 'settings';

export const ProfileSettingsTab: React.FC<ProfileSettingsTabProps> = ({
  open,
  selfUser,
  language,
  darkMode,
  isAdminEligible,
  unreadNotificationsCount,
  onClose,
  onToggleDarkMode,
  onUserUpdated,
  onOpenMyQr,
  onOpenScanQr,
  onOpenNotifications,
  onOpenAdmin,
  onLoggedOut,
  onPreviewPhoto,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);

  const [subView, setSubView] = useState<MeSubView>('menu');
  const [displayName, setDisplayName] = useState(selfUser.displayName);
  const [bio, setBio] = useState(selfUser.bio);
  const [discoverPhone, setDiscoverPhone] = useState(selfUser.discoverableByPhone);
  const [discoverName, setDiscoverName] = useState(selfUser.discoverableByName);
  const [showOnline, setShowOnline] = useState(selfUser.showOnlineStatus);
  const [dataSaver, setDataSaver] = useState(selfUser.dataSaver);
  const [recoveryPin, setRecoveryPin] = useState('');

  const [blockedUsers, setBlockedUsers] = useState<PublicUser[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareToast, setShareToast] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [previewingId, setPreviewingId] = useState<RomanticRingtoneId | null>(null);
  const [confirmedRingtoneId, setConfirmedRingtoneId] = useState<RomanticRingtoneId>(() =>
    getSelectedRingtoneId()
  );
  const [draftRingtoneId, setDraftRingtoneId] = useState<RomanticRingtoneId>(() =>
    getSelectedRingtoneId()
  );
  const [ringtoneConfirmedNotice, setRingtoneConfirmedNotice] = useState(false);

  useEffect(() => {
    setDisplayName(selfUser.displayName);
    setBio(selfUser.bio);
    setDiscoverPhone(selfUser.discoverableByPhone);
    setDiscoverName(selfUser.discoverableByName);
    setShowOnline(selfUser.showOnlineStatus);
    setDataSaver(selfUser.dataSaver);
  }, [selfUser]);

  useEffect(() => {
    if (!open) {
      setSubView('menu');
      setConfirmSwitch(false);
      setConfirmDelete(false);
      ringtone.stop();
      setPreviewingId(null);
      return;
    }
    apiFetch<{ blocked: PublicUser[] }>('/api/blocks')
      .then((res) => setBlockedUsers(res.blocked))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    return () => {
      ringtone.stop();
    };
  }, []);

  if (!open) return null;

  const saveChanges = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setError(null);
    setSavedFlag(false);
    try {
      const res = await apiFetch<{ user: SelfUser }>('/api/users/me', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onUserUpdated(res.user);
      setRecoveryPin('');
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSaving(true);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 640);
      const uploaded = await apiFetch<{ url: string }>('/api/uploads/image', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, purpose: 'avatar' }),
      });
      onUserUpdated({ ...selfUser, avatarUrl: uploaded.url });
      setSavedFlag(true);
      setTimeout(() => setSavedFlag(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload photo.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAvatar = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch<{ user: SelfUser }>('/api/users/me/avatar', {
        method: 'DELETE',
      });
      onUserUpdated(res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove photo.');
    } finally {
      setSaving(false);
    }
  };

  const handleUnblock = async (userId: string) => {
    try {
      await apiFetch(`/api/blocks/${userId}`, { method: 'DELETE' });
      setBlockedUsers((prev) => prev.filter((u) => u.id !== userId));
    } catch {
      // Ignore
    }
  };

  const handleDeleteAccount = async () => {
    setSaving(true);
    try {
      await apiFetch('/api/users/me', { method: 'DELETE' });
      onLoggedOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete account.');
      setSaving(false);
    }
  };

  const handleShareApp = async () => {
    const shareUrl = window.location.origin;
    const shareText = `Call & message me on EASY CALL! ID: ${selfUser.qrToken}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'EASY CALL', text: shareText, url: shareUrl });
        return;
      } catch {
        // Fallback to copy
      }
    }
    try {
      await navigator.clipboard.writeText(`${shareText} (${shareUrl})`);
      setShareToast('Invite link copied!');
    } catch {
      setShareToast(shareUrl);
    }
    setTimeout(() => setShareToast(null), 2600);
  };

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-[#F3F4F6] dark:bg-slate-950">
      <div className="mx-auto min-h-full max-w-3xl bg-white dark:bg-slate-900 shadow-sm pb-12">
        {subView === 'menu' ? (
          <>
            {/* Screenshot 2 Top Curved Sky-Blue Header */}
            <div className="relative overflow-hidden bg-gradient-to-b from-[#E8F3FF] via-[#F3F8FF] to-white dark:from-slate-800/90 dark:via-slate-900 dark:to-slate-900 border-b-[8px] border-[#F3F4F6] dark:border-slate-950">
              {/* Subtle Decorative Accent Shape matching Screenshot 2 */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-12 start-8 h-40 w-40 rounded-full bg-sky-200/35 dark:bg-sky-500/10 blur-xl"
              />

              {/* Top Bar: X Me | Moon QR */}
              <div className="relative flex h-14 items-center justify-between px-4 pt-safe">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={t('close')}
                    className="flex min-h-[44px] min-w-[44px] -ms-2 items-center justify-center rounded-full text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <X className="h-6 w-6" />
                  </button>
                  <span className="text-[19px] font-semibold text-slate-900 dark:text-white">
                    Me
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={onToggleDarkMode}
                    aria-label={darkMode ? t('lightMode') : t('darkMode')}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
                  </button>
                  <button
                    type="button"
                    onClick={onOpenMyQr}
                    aria-label={t('myQrCode')}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-800 dark:text-slate-100 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    <QrCode className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {/* Profile Header Identity Row */}
              <div className="relative flex items-center gap-4 px-4 pt-2 pb-5">
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      onPreviewPhoto({
                        url: selfUser.avatarUrl,
                        name: selfUser.displayName || selfUser.phoneE164,
                        subtitle: selfUser.phoneE164,
                      })
                    }
                    aria-label="View profile photo"
                    className="rounded-full focus-visible:outline-2 focus-visible:outline-[#1D8BF1]"
                  >
                    <Avatar
                      src={selfUser.avatarUrl}
                      name={selfUser.displayName || selfUser.phoneE164}
                      size="lg"
                    />
                  </button>
                  <label
                    title={t('uploadPhoto')}
                    className="absolute -bottom-0.5 -end-0.5 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 shadow-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleAvatarUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <button
                  type="button"
                  onClick={() => setSubView('edit')}
                  className="flex flex-1 items-center justify-between gap-2 min-w-0 text-start py-1"
                >
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-[19px] font-semibold text-slate-900 dark:text-white truncate">
                      {selfUser.displayName || selfUser.phoneE164}
                    </p>
                    <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate">
                      EASY ID: {selfUser.qrToken}
                    </p>
                    <p className="flex items-center gap-1.5 text-[13px] text-slate-500 dark:text-slate-400 truncate">
                      <span>Phone: {selfUser.phoneE164}</span>
                      <ShieldCheck className="h-4 w-4 text-[#1D8BF1] shrink-0" />
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-slate-400 shrink-0" />
                </button>
              </div>
            </div>

            {shareToast && (
              <div className="mx-4 my-2 rounded-xl bg-sky-50 dark:bg-sky-950/50 px-4 py-2 text-xs font-semibold text-[#1D8BF1]">
                {shareToast}
              </div>
            )}

            {/* Group 1: Switch Account */}
            <div className="border-b-[8px] border-[#F3F4F6] dark:border-slate-950">
              {!confirmSwitch ? (
                <button
                  type="button"
                  onClick={() => setConfirmSwitch(true)}
                  className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center gap-4">
                    <ArrowLeftRight className="h-5 w-5 text-[#1D8BF1] shrink-0" />
                    <span className="text-[15.5px] text-slate-900 dark:text-white">
                      Switch Account
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/60">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Sign out and switch phone number?
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmSwitch(false)}
                      className="h-9 rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                        onLoggedOut();
                      }}
                      className="h-9 rounded-lg bg-[#1D8BF1] px-3 text-xs font-semibold text-white"
                    >
                      {t('logout')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Group 2: Security & Privacy + Settings */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border-b-[8px] border-[#F3F4F6] dark:border-slate-950">
              <button
                type="button"
                onClick={() => setSubView('security')}
                className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-4">
                  <Shield className="h-5 w-5 text-[#1D8BF1] shrink-0" />
                  <span className="text-[15.5px] text-slate-900 dark:text-white">
                    Security & Privacy
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={() => setSubView('settings')}
                className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-4">
                  <Settings className="h-5 w-5 text-[#1D8BF1] shrink-0" />
                  <span className="text-[15.5px] text-slate-900 dark:text-white">
                    Settings
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>
            </div>

            {/* Group 3: QR & Notifications */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border-b-[8px] border-[#F3F4F6] dark:border-slate-950">
              <button
                type="button"
                onClick={onOpenMyQr}
                className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-4">
                  <QrCode className="h-5 w-5 text-amber-500 shrink-0" />
                  <span className="text-[15.5px] text-slate-900 dark:text-white">
                    {t('myQrCode')}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={onOpenScanQr}
                className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-4">
                  <ScanLine className="h-5 w-5 text-emerald-500 shrink-0" />
                  <span className="text-[15.5px] text-slate-900 dark:text-white">
                    {t('scanQrCode')}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-400" />
              </button>

              <button
                type="button"
                onClick={onOpenNotifications}
                className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-4">
                  <Bell className="h-5 w-5 text-indigo-500 shrink-0" />
                  <span className="text-[15.5px] text-slate-900 dark:text-white">
                    {t('notifications')}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {unreadNotificationsCount > 0 && (
                    <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">
                      {unreadNotificationsCount}
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </div>
              </button>
            </div>

            {/* Group 4: Share EASY CALL & APK Builder */}
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              <button
                type="button"
                onClick={handleShareApp}
                className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
              >
                <div className="flex items-center gap-4">
                  <Share2 className="h-5 w-5 text-[#1D8BF1] shrink-0" />
                  <span className="text-[15.5px] text-slate-900 dark:text-white">
                    Share EASY CALL
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Share EASY CALL</span>
                  <ChevronRight className="h-4 w-4" />
                </div>
              </button>

              {isAdminEligible && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAdmin();
                  }}
                  className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center gap-4">
                    <Download className="h-5 w-5 text-[#1D8BF1] shrink-0" />
                    <span className="text-[15.5px] text-slate-900 dark:text-white">
                      Android APK Builder
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </button>
              )}
            </div>
          </>
        ) : (
          /* Sub-Views: Edit Profile, Security & Privacy, Settings */
          <div>
            <div className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 pt-safe">
              <button
                type="button"
                onClick={() => {
                  ringtone.stop();
                  setPreviewingId(null);
                  setSubView('menu');
                }}
                aria-label="Back"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <h2 className="text-[17px] font-semibold text-slate-900 dark:text-white">
                {subView === 'edit'
                  ? t('profileTitle')
                  : subView === 'security'
                  ? 'Security & Privacy'
                  : 'Settings'}
              </h2>
            </div>

            {error && (
              <p className="m-4 rounded-xl bg-rose-50 dark:bg-rose-950/50 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
                {error}
              </p>
            )}

            {subView === 'edit' && (
              <div className="p-4 sm:p-6 space-y-5">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() =>
                      onPreviewPhoto({
                        url: selfUser.avatarUrl,
                        name: selfUser.displayName || selfUser.phoneE164,
                        subtitle: selfUser.phoneE164,
                      })
                    }
                    aria-label="View profile photo"
                    className="rounded-full shrink-0"
                  >
                    <Avatar
                      src={selfUser.avatarUrl}
                      name={selfUser.displayName || selfUser.phoneE164}
                      size="xl"
                    />
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-[#1D8BF1] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-sky-600">
                      <Camera className="h-4 w-4" />
                      {t('uploadPhoto')}
                      <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                    </label>
                    {selfUser.avatarUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
                      >
                        {t('removePhoto')}
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('displayNameLabel')}
                  </label>
                  <input
                    type="text"
                    maxLength={60}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    {t('bioLabel')}
                  </label>
                  <input
                    type="text"
                    maxLength={160}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Available for family calls"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveChanges({ displayName, bio })}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#1D8BF1] px-5 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                >
                  {savedFlag ? <Check className="h-4 w-4" /> : null}
                  {savedFlag ? t('savedNotice') : t('saveProfile')}
                </button>
              </div>
            )}

            {subView === 'security' && (
              <div className="p-4 sm:p-6 space-y-5">
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {t('discoverPhone')}
                    </span>
                    <input
                      type="checkbox"
                      checked={discoverPhone}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setDiscoverPhone(next);
                        saveChanges({ discoverableByPhone: next });
                      }}
                      className="h-5 w-5 accent-[#1D8BF1]"
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {t('discoverName')}
                    </span>
                    <input
                      type="checkbox"
                      checked={discoverName}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setDiscoverName(next);
                        saveChanges({ discoverableByName: next });
                      }}
                      className="h-5 w-5 accent-[#1D8BF1]"
                    />
                  </label>

                  <label className="flex cursor-pointer items-center justify-between gap-4 py-3">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {t('showOnline')}
                    </span>
                    <input
                      type="checkbox"
                      checked={showOnline}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setShowOnline(next);
                        saveChanges({ showOnlineStatus: next });
                      }}
                      className="h-5 w-5 accent-[#1D8BF1]"
                    />
                  </label>
                </div>

                {/* Recovery PIN */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200">
                    <KeyRound className="h-4 w-4 text-[#1D8BF1]" />
                    {t('setRecoveryPin')} {selfUser.hasRecoveryPin ? '(Configured)' : ''}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={8}
                      value={recoveryPin}
                      onChange={(e) => setRecoveryPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
                      placeholder="4–8 digits"
                      className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={recoveryPin.length < 4 || saving}
                      onClick={() => saveChanges({ recoveryPin })}
                      className="min-h-[44px] rounded-xl bg-slate-900 dark:bg-slate-700 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      Save PIN
                    </button>
                  </div>
                </div>

                {/* Blocked Users */}
                {blockedUsers.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                      {t('blockedUsers')}
                    </p>
                    <div className="space-y-2">
                      {blockedUsers.map((u) => (
                        <div
                          key={u.id}
                          className="flex items-center justify-between rounded-xl bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5"
                        >
                          <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                            {u.displayName}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleUnblock(u.id)}
                            className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200"
                          >
                            {t('unblock')}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sign Out & Delete Account */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
                      onLoggedOut();
                    }}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-semibold text-slate-800 dark:text-slate-100"
                  >
                    <LogOut className="h-4 w-4" />
                    {t('logout')}
                  </button>

                  {confirmDelete ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDeleteAccount}
                        className="min-h-[44px] rounded-xl bg-rose-600 px-4 text-xs font-semibold text-white"
                      >
                        Confirm Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(false)}
                        className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-3 text-xs font-medium"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('deleteAccount')}
                    </button>
                  )}
                </div>
              </div>
            )}

            {subView === 'settings' && (
              <div className="p-4 sm:p-6 space-y-5">
                {/* Language & Theme */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
                      <Globe className="h-4 w-4 text-[#1D8BF1]" />
                      {t('language')}
                    </label>
                    <select
                      value={language}
                      onChange={(e) => saveChanges({ language: e.target.value })}
                      className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-medium text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
                    >
                      {SUPPORTED_LANGUAGES.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.nativeName} ({l.englishName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
                      {t('appearance')}
                    </p>
                    <button
                      type="button"
                      onClick={onToggleDarkMode}
                      className="flex w-full min-h-[48px] items-center justify-between rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 text-sm font-medium text-slate-900 dark:text-white"
                    >
                      <span className="flex items-center gap-2">
                        {darkMode ? (
                          <Moon className="h-4 w-4 text-[#1D8BF1]" />
                        ) : (
                          <Sun className="h-4 w-4 text-amber-500" />
                        )}
                        {darkMode ? t('darkMode') : t('lightMode')}
                      </span>
                      <span className="text-xs font-semibold text-[#1D8BF1]">Switch</span>
                    </button>
                  </div>
                </div>

                {/* Data Saver */}
                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
                  <div className="flex items-start gap-3">
                    <Wifi className="mt-0.5 h-5 w-5 text-[#1D8BF1] shrink-0" />
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-white">{t('dataSaver')}</p>
                      <p className="text-xs text-slate-600 dark:text-slate-400">{t('dataSaverDesc')}</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={dataSaver}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setDataSaver(next);
                      saveChanges({ dataSaver: next });
                    }}
                    className="h-5 w-5 accent-[#1D8BF1] shrink-0"
                  />
                </label>

                {/* 5 Romantic Ringtones Audition & Confirm */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-start gap-3">
                      <Music className="mt-0.5 h-5 w-5 text-[#1D8BF1] shrink-0" />
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-white">
                          EASY CALL Ringtone (5 Romantic Options)
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          আগে শুনুন, পছন্দেরটা বেছে নিয়ে Confirm চাপুন
                        </p>
                      </div>
                    </div>
                    {ringtoneConfirmedNotice && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#22C55E] px-2.5 py-1 text-xs font-semibold text-white">
                        <Check className="h-3.5 w-3.5" />
                        Confirmed
                      </span>
                    )}
                  </div>

                  <div className="space-y-2">
                    {ROMANTIC_RINGTONES.map((item) => {
                      const isPlaying = previewingId === item.id;
                      const isDraftSelected = draftRingtoneId === item.id;
                      const isActive = confirmedRingtoneId === item.id;
                      return (
                        <div
                          key={item.id}
                          onClick={() => setDraftRingtoneId(item.id)}
                          className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                            isDraftSelected
                              ? 'border-[#1D8BF1] bg-white dark:bg-slate-900 shadow-xs'
                              : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                isDraftSelected
                                  ? 'border-[#1D8BF1] bg-[#1D8BF1] text-white'
                                  : 'border-slate-300 dark:border-slate-600'
                              }`}
                            >
                              {isDraftSelected && <Check className="h-3 w-3" />}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                                  {item.title}
                                </p>
                                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                                  {item.durationLabel}
                                </span>
                                {isActive && (
                                  <span className="rounded-md bg-sky-100 dark:bg-sky-900/50 px-2 py-0.5 text-[11px] font-semibold text-[#1D8BF1]">
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                {item.subtitle}
                              </p>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraftRingtoneId(item.id);
                              if (isPlaying) {
                                ringtone.stop();
                                setPreviewingId(null);
                              } else {
                                ringtone.preview(item.id);
                                setPreviewingId(item.id);
                              }
                            }}
                            className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-3.5 text-xs font-semibold transition-colors shrink-0 ${
                              isPlaying
                                ? 'bg-rose-600 text-white hover:bg-rose-700'
                                : 'bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-800'
                            }`}
                          >
                            {isPlaying ? (
                              <>
                                <Square className="h-3 w-3 fill-current" />
                                Stop
                              </>
                            ) : (
                              <>
                                <Volume2 className="h-3.5 w-3.5" />
                                Listen
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      Selected:{' '}
                      <span className="font-semibold text-slate-900 dark:text-white">
                        {ROMANTIC_RINGTONES.find((r) => r.id === draftRingtoneId)?.title}
                      </span>
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRingtoneId(draftRingtoneId);
                        setConfirmedRingtoneId(draftRingtoneId);
                        ringtone.stop();
                        setPreviewingId(null);
                        setRingtoneConfirmedNotice(true);
                        setTimeout(() => setRingtoneConfirmedNotice(false), 3000);
                      }}
                      className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-[#1D8BF1] px-4 py-2 text-xs font-semibold text-white hover:bg-sky-600"
                    >
                      <Check className="h-4 w-4" />
                      {confirmedRingtoneId === draftRingtoneId ? 'Confirmed' : 'Confirm Selected Ringtone'}
                    </button>
                  </div>
                </div>

                {/* PWA Install & APK */}
                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <PWAInstallButton />
                  {isAdminEligible && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAdmin();
                      }}
                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#1D8BF1] px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600"
                    >
                      <Download className="h-4 w-4" />
                      APK Builder
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
