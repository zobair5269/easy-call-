import React, { useState } from 'react';
import {
  ArrowLeft,
  Check,
  Phone,
  QrCode,
  Search,
  ShieldAlert,
  Upload,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch } from '../lib/api';
import { getNativeDeviceContacts, hasNativeAndroidBridge } from '../lib/nativeBridge';
import type { FriendRequestItem, PublicUser } from '../types/app';
import { Avatar } from './Avatar';

interface ContactsPanelProps {
  language: string;
  incomingRequests: FriendRequestItem[];
  outgoingRequests: FriendRequestItem[];
  onRefreshAll: () => void;
  onOpenQrScanner: () => void;
  onBack?: () => void;
}

export const ContactsPanel: React.FC<ContactsPanelProps> = ({
  language,
  incomingRequests,
  outgoingRequests,
  onRefreshAll,
  onOpenQrScanner,
  onBack,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);

  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  const [syncOpen, setSyncOpen] = useState(false);
  const [syncNumbersText, setSyncNumbersText] = useState('');
  const [matchedContacts, setMatchedContacts] = useState<PublicUser[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const runSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    setHasSearched(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ results: PublicUser[] }>(
        `/api/users/search?q=${encodeURIComponent(q)}`
      );
      setSearchResults(res.results);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Search failed.');
    } finally {
      setSearching(false);
    }
  };

  const sendFriendRequest = async (userId: string) => {
    setFeedback(null);
    try {
      await apiFetch('/api/friend-requests', {
        method: 'POST',
        body: JSON.stringify({ toUserId: userId }),
      });
      setSearchResults((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, requestStatus: 'outgoing_pending' } : u))
      );
      setMatchedContacts((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, requestStatus: 'outgoing_pending' } : u))
      );
      onRefreshAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not send request.');
    }
  };

  const respondRequest = async (requestId: string, action: 'accept' | 'reject', fromUserId?: string) => {
    setFeedback(null);
    try {
      await apiFetch(`/api/friend-requests/${requestId}/respond`, {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      if (fromUserId) {
        setSearchResults((prev) =>
          prev.map((u) =>
            u.id === fromUserId
              ? {
                  ...u,
                  isFriend: action === 'accept',
                  requestStatus: action === 'accept' ? 'accepted' : 'none',
                }
              : u
          )
        );
      }
      onRefreshAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not update request.');
    }
  };

  const matchNumbers = async (numbers: string[]) => {
    setSyncing(true);
    setFeedback(null);
    try {
      const res = await apiFetch<{ matches: PublicUser[] }>('/api/contacts/match', {
        method: 'POST',
        body: JSON.stringify({ numbers }),
      });
      setMatchedContacts(res.matches);
      if (res.matches.length === 0) {
        setFeedback('No registered EASY CALL contacts matched those numbers.');
      } else {
        setFeedback(`${res.matches.length} registered EASY CALL contact(s) added to your Contacts list.`);
        onRefreshAll();
      }
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Contact match failed.');
    } finally {
      setSyncing(false);
    }
  };

  const handleBrowserContactPicker = async () => {
    if (hasNativeAndroidBridge()) {
      const nativeNums = getNativeDeviceContacts();
      if (nativeNums.length > 0) {
        await matchNumbers(nativeNums);
        return;
      }
    }
    const nav = navigator as unknown as {
      contacts?: { select: (props: string[], opts?: { multiple: boolean }) => Promise<Array<{ tel?: string[] }>> };
    };
    if (!nav.contacts || typeof nav.contacts.select !== 'function') {
      setFeedback('Direct device contact picker is supported on mobile Android Chrome & EASY CALL APK. Use .vcf import or paste numbers below.');
      return;
    }
    try {
      const picked = await nav.contacts.select(['tel'], { multiple: true });
      const nums = picked.flatMap((p) => p.tel || []);
      if (nums.length > 0) {
        await matchNumbers(nums);
      }
    } catch {
      setFeedback('Contact permission cancelled.');
    }
  };

  const handleVcfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const nums: string[] = [];
      for (const line of text.split(/\r?\n/)) {
        if (line.toUpperCase().startsWith('TEL')) {
          const val = line.split(':').slice(1).join(':').trim();
          if (val) nums.push(val);
        }
      }
      if (nums.length > 0) {
        matchNumbers(nums);
      } else {
        setFeedback('No phone numbers found in this .vcf contact file.');
      }
    };
    reader.readAsText(file);
  };

  const blockUser = async (userId: string) => {
    try {
      await apiFetch('/api/blocks', {
        method: 'POST',
        body: JSON.stringify({ userId }),
      });
      setSearchResults((prev) => prev.filter((u) => u.id !== userId));
      onRefreshAll();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to block user.');
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 min-h-[calc(100vh-116px)]">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex min-h-[40px] min-w-[40px] -ms-2 items-center justify-center rounded-full text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <h2 className="text-[17px] font-semibold text-slate-900 dark:text-white">
            New Contacts
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenQrScanner}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
          >
            <QrCode className="h-4 w-4 text-[#1D8BF1]" />
            {t('scanQr')}
          </button>
          <button
            type="button"
            onClick={() => setSyncOpen((v) => !v)}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#1D8BF1] px-3 text-xs font-semibold text-white hover:bg-sky-600 whitespace-nowrap"
          >
            <Users className="h-4 w-4" />
            {t('syncContacts')}
          </button>
        </div>
      </div>

      {/* Global Search + Discovery Toolbar */}
      <div className="border-b-[8px] border-[#F3F4F6] dark:border-slate-950 p-4 space-y-4">
        <form onSubmit={runSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full min-h-[48px] rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ps-10 pe-4 text-sm sm:text-base text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="min-h-[48px] rounded-2xl bg-slate-900 dark:bg-slate-700 px-5 text-sm font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {searching ? '...' : 'Search'}
          </button>
        </form>

        {feedback && (
          <p className="rounded-xl bg-slate-100 dark:bg-slate-800 px-4 py-2.5 text-sm text-slate-700 dark:text-slate-300">
            {feedback}
          </p>
        )}

        {/* Search Results */}
        {hasSearched && !searching && searchResults.length === 0 && !feedback && (
          <p className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-sm text-slate-600 dark:text-slate-300">
            No matching EASY CALL users found. Try searching by full phone number with country code (e.g. +880...), local digits, or display name.
          </p>
        )}

        {searchResults.length > 0 && (
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('searchResults')}
            </h3>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800">
              {searchResults.map((u) => {
                const matchingIncoming =
                  u.requestStatus === 'incoming_pending'
                    ? incomingRequests.find((r) => r.user.id === u.id)
                    : undefined;
                return (
                <div key={u.id} className="flex items-center justify-between gap-3 p-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={u.avatarUrl} name={u.displayName} size="md" />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {u.displayName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {u.countryIso} · {u.phoneE164 || 'Private number'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {u.isFriend ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 dark:text-teal-400">
                        <UserCheck className="h-4 w-4" />
                        Friend
                      </span>
                    ) : u.requestStatus === 'outgoing_pending' ? (
                      <span className="text-xs font-semibold text-slate-500">{t('requestSent')}</span>
                    ) : u.requestStatus === 'incoming_pending' ? (
                      matchingIncoming ? (
                        <button
                          type="button"
                          onClick={() => respondRequest(matchingIncoming.requestId, 'accept', u.id)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-800 whitespace-nowrap"
                        >
                          <Check className="h-4 w-4" />
                          {t('acceptRequest')}
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">
                          {t('friendRequests')}
                        </span>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => sendFriendRequest(u.id)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-800 whitespace-nowrap"
                      >
                        <UserPlus className="h-4 w-4" />
                        {t('sendRequest')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => blockUser(u.id)}
                      title={t('blockUser')}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40"
                    >
                      <ShieldAlert className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Permission-First Phone Contact Sync Drawer */}
      {syncOpen && (
        <div className="rounded-3xl border border-teal-200 dark:border-teal-900 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
                {t('contactsPermissionTitle')}
              </h3>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {t('contactsPermissionBody')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setSyncOpen(false)}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleBrowserContactPicker}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
            >
              <Phone className="h-4 w-4" />
              {t('allowContactsSync')}
            </button>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800">
              <Upload className="h-4 w-4" />
              {t('uploadVcf')}
              <input type="file" accept=".vcf,text/vcard" onChange={handleVcfUpload} className="hidden" />
            </label>
          </div>

          <div className="space-y-2">
            <textarea
              rows={3}
              value={syncNumbersText}
              onChange={(e) => setSyncNumbersText(e.target.value)}
              placeholder={t('pasteNumbersHint')}
              className="w-full rounded-2xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 font-mono text-sm text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
            />
            <button
              type="button"
              disabled={syncing || !syncNumbersText.trim()}
              onClick={() =>
                matchNumbers(
                  syncNumbersText
                    .split(/[\n,;]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                )
              }
              className="min-h-[44px] rounded-xl bg-slate-900 dark:bg-slate-700 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {syncing ? '...' : t('findMatches')}
            </button>
          </div>

          {matchedContacts.length > 0 && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-2xl border border-slate-200 dark:border-slate-800">
              {matchedContacts.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 p-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar src={u.avatarUrl} name={u.displayName} size="md" />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {u.displayName}
                      </p>
                      <p className="font-mono text-xs text-slate-500">{u.phoneE164}</p>
                    </div>
                  </div>
                  {u.isFriend ? (
                    <span className="text-xs font-semibold text-teal-700 dark:text-teal-400">Friend</span>
                  ) : u.requestStatus === 'outgoing_pending' ? (
                    <span className="text-xs font-semibold text-slate-500">{t('requestSent')}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sendFriendRequest(u.id)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                    >
                      <UserPlus className="h-4 w-4" />
                      {t('sendRequest')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Incoming Friend Requests (Mandatory Approval) */}
      <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
        <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
          {t('friendRequests')} ({incomingRequests.length})
        </h3>

        {incomingRequests.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">{t('noRequests')}</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {incomingRequests.map((req) => (
              <div
                key={req.requestId}
                className="flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={req.user.avatarUrl} name={req.user.displayName} size="md" />
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                      {req.user.displayName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {req.user.countryIso} · {new Date(req.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => respondRequest(req.requestId, 'accept')}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
                  >
                    <Check className="h-4 w-4" />
                    {t('acceptRequest')}
                  </button>
                  <button
                    type="button"
                    onClick={() => respondRequest(req.requestId, 'reject')}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="h-4 w-4" />
                    {t('rejectRequest')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {outgoingRequests.length > 0 && (
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t('requestSent')} ({outgoingRequests.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {outgoingRequests.map((req) => (
                <div
                  key={req.requestId}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  <span>{req.user.displayName}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
