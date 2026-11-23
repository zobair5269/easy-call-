import React, { useEffect, useState } from 'react';
import {
  Camera,
  Check,
  Globe,
  KeyRound,
  LogOut,
  Moon,
  Music,
  QrCode,
  Shield,
  Square,
  Sun,
  Trash2,
  Volume2,
  Wifi,
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
import { PWAInstallButton } from './PWAInstallButton';

interface ProfileSettingsTabProps {
  selfUser: SelfUser;
  language: string;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onUserUpdated: (user: SelfUser) => void;
  onOpenMyQr: () => void;
  onLoggedOut: () => void;
}

export const ProfileSettingsTab: React.FC<ProfileSettingsTabProps> = ({
  selfUser,
  language,
  darkMode,
  onToggleDarkMode,
  onUserUpdated,
  onOpenMyQr,
  onLoggedOut,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);

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
    apiFetch<{ blocked: PublicUser[] }>('/api/blocks')
      .then((res) => setBlockedUsers(res.blocked))
      .catch(() => {});
  }, []);

  useEffect(() => {
    return () => {
      ringtone.stop();
    };
  }, []);

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

  return (
    <div className="space-y-6">
      {/* Personal Profile Card */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar
              src={selfUser.avatarUrl}
              name={selfUser.displayName || selfUser.phoneE164}
              size="xl"
            />
            <div>
              <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
                {selfUser.displayName || selfUser.phoneE164}
              </h2>
              <p className="font-mono text-sm text-slate-600 dark:text-slate-300">
                {selfUser.phoneE164}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800">
                  <Camera className="h-4 w-4" />
                  {t('uploadPhoto')}
                  <input type="file" accept="image/*" onChange={handleAvatarUpload} className="hidden" />
                </label>
                {selfUser.avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {t('removePhoto')}
                  </button>
                )}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onOpenMyQr}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <QrCode className="h-4 w-4 text-teal-700 dark:text-teal-400" />
            {t('myQrCode')}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {t('displayNameLabel')}
            </label>
            <input
              type="text"
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
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
              className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <PWAInstallButton />
          <button
            type="button"
            disabled={saving}
            onClick={() => saveChanges({ displayName, bio })}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
          >
            {savedFlag ? <Check className="h-4 w-4" /> : null}
            {savedFlag ? t('savedNotice') : t('saveProfile')}
          </button>
        </div>

        {error && (
          <p className="rounded-xl bg-rose-50 dark:bg-rose-950/50 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </p>
        )}
      </section>

      {/* Language, Theme & Data Saver */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
              <Globe className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              {t('language')}
            </label>
            <select
              value={language}
              onChange={(e) => saveChanges({ language: e.target.value })}
              className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm font-medium text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
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
              className="flex w-full min-h-[48px] items-center justify-between rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 text-sm font-medium text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700"
            >
              <span className="flex items-center gap-2">
                {darkMode ? <Moon className="h-4 w-4 text-teal-400" /> : <Sun className="h-4 w-4 text-amber-500" />}
                {darkMode ? t('darkMode') : t('lightMode')}
              </span>
              <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">Switch</span>
            </button>
          </div>
        </div>

        {/* Data Saver Toggle */}
        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4">
          <div className="flex items-start gap-3">
            <Wifi className="mt-0.5 h-5 w-5 text-teal-700 dark:text-teal-400 shrink-0" />
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
            className="h-5 w-5 accent-teal-700 shrink-0"
          />
        </label>

        {/* Romantic Ringtone Audition & Selector */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-start gap-3">
              <Music className="mt-0.5 h-5 w-5 text-teal-700 dark:text-teal-400 shrink-0" />
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
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
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
                      ? 'border-teal-600 bg-white dark:bg-slate-900 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                        isDraftSelected
                          ? 'border-teal-600 bg-teal-600 text-white'
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
                          <span className="rounded-md bg-teal-100 dark:bg-teal-900/50 px-2 py-0.5 text-[11px] font-semibold text-teal-800 dark:text-teal-300">
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
              className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"
            >
              <Check className="h-4 w-4" />
              {confirmedRingtoneId === draftRingtoneId ? 'Confirmed' : 'Confirm Selected Ringtone'}
            </button>
          </div>
        </div>
      </section>

      {/* Privacy & Security Controls */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
        <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Shield className="h-5 w-5 text-teal-700 dark:text-teal-400" />
          {t('privacySecurity')}
        </h3>

        <div className="space-y-3">
          <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
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
              className="h-5 w-5 accent-teal-700"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between gap-4 py-2 border-t border-slate-100 dark:border-slate-800">
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
              className="h-5 w-5 accent-teal-700"
            />
          </label>

          <label className="flex cursor-pointer items-center justify-between gap-4 py-2 border-t border-slate-100 dark:border-slate-800">
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
              className="h-5 w-5 accent-teal-700"
            />
          </label>
        </div>

        {/* Recovery PIN */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-800 dark:text-slate-200 mb-2">
            <KeyRound className="h-4 w-4 text-teal-700 dark:text-teal-400" />
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
              className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
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
                    className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-700"
                  >
                    {t('unblock')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Sign Out & Account Deletion */}
      <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <button
          type="button"
          onClick={async () => {
            await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
            onLoggedOut();
          }}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <LogOut className="h-4 w-4" />
          {t('logout')}
        </button>

        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-rose-700 dark:text-rose-400">
              {t('deleteAccountConfirm')}
            </span>
            <button
              type="button"
              onClick={handleDeleteAccount}
              className="min-h-[44px] rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Confirm Delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-2 text-xs font-medium"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-4 w-4" />
            {t('deleteAccount')}
          </button>
        )}
      </section>
    </div>
  );
};
