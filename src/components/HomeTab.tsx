import React, { useEffect, useState } from 'react';
import {
  Flag,
  Loader2,
  MessageSquare,
  MoreVertical,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Search,
  ShieldAlert,
  Video,
  X,
} from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch } from '../lib/api';
import type { CallRecordItem, HomeFeedItem, PublicUser } from '../types/app';
import { Avatar } from './Avatar';

interface HomeTabProps {
  language: string;
  homeFeed: HomeFeedItem[];
  recentCalls: CallRecordItem[];
  onStartCall: (peer: PublicUser, callType: 'audio' | 'video') => void;
  onOpenChat: (peer: PublicUser) => void;
  onRefreshAll: () => void;
}

function formatShortTime(ts: number): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  language,
  homeFeed,
  recentCalls,
  onStartCall,
  onOpenChat,
  onRefreshAll,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [menuUserId, setMenuUserId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<PublicUser | null>(null);
  const [reportReason, setReportReason] = useState('Harassment or spam');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ results: PublicUser[] }>(
          `/api/users/search?q=${encodeURIComponent(trimmedQuery)}`
        );
        if (!cancelled) {
          setSearchResults(res.results || []);
        }
      } catch (err) {
        if (!cancelled) {
          setSearchError(err instanceof Error ? err.message : 'Search failed.');
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedQuery]);

  const handleBlockUser = async (userId: string) => {
    setMenuUserId(null);
    await apiFetch('/api/blocks', {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }).catch(() => {});
    onRefreshAll();
  };

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportTarget) return;
    await apiFetch('/api/reports', {
      method: 'POST',
      body: JSON.stringify({ userId: reportTarget.id, reason: reportReason }),
    }).catch(() => {});
    setReportTarget(null);
    setActionMsg('Report submitted to safety team.');
    setTimeout(() => setActionMsg(null), 3000);
  };

  const renderPersonRow = (
    peer: PublicUser,
    subtitleNode: React.ReactNode,
    timeLabel?: string,
    unreadCount = 0
  ) => (
    <div
      key={peer.id}
      className="relative flex flex-wrap items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0"
    >
      <button
        type="button"
        onClick={() => onOpenChat(peer)}
        className="flex flex-1 items-center gap-3.5 min-w-0 text-start"
      >
        <Avatar
          src={peer.avatarUrl}
          name={peer.displayName || peer.phoneE164 || 'User'}
          size="md"
          online={peer.showOnlineStatus ? peer.online : undefined}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
              {peer.displayName || peer.phoneE164}
            </p>
            {timeLabel && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                {timeLabel}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 min-w-0">
            <div className="truncate flex items-center gap-1.5 min-w-0">{subtitleNode}</div>
            {unreadCount > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-teal-600 px-1.5 text-[10px] font-bold text-white shrink-0">
                {unreadCount}
              </span>
            )}
          </div>
        </div>
      </button>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => onStartCall(peer, 'audio')}
          aria-label={`${t('audioCall')} ${peer.displayName}`}
          title={t('audioCall')}
          className="inline-flex min-h-[42px] min-w-[42px] items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-700 to-emerald-700 px-3 text-sm font-semibold text-white hover:from-teal-800 hover:to-emerald-800 shadow-xs transition-all"
        >
          <Phone className="h-4 w-4" />
          <span className="hidden sm:inline">{t('audioCall')}</span>
        </button>

        <button
          type="button"
          onClick={() => onStartCall(peer, 'video')}
          aria-label={`${t('videoCall')} ${peer.displayName}`}
          title={t('videoCall')}
          className="inline-flex min-h-[42px] min-w-[42px] items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-700 px-3 text-sm font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 shadow-xs transition-all"
        >
          <Video className="h-4 w-4" />
          <span className="hidden sm:inline">{t('videoCall')}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenChat(peer)}
          aria-label={`${t('message')} ${peer.displayName}`}
          title={t('message')}
          className="flex min-h-[42px] min-w-[42px] items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuUserId((prev) => (prev === peer.id ? null : peer.id))}
            aria-label="More options"
            className="flex min-h-[42px] min-w-[36px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <MoreVertical className="h-4 w-4" />
          </button>

          {menuUserId === peer.id && (
            <div className="absolute end-0 z-20 mt-1 w-44 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  setMenuUserId(null);
                  setReportTarget(peer);
                }}
                className="flex w-full min-h-[40px] items-center gap-2 rounded-xl px-3 text-start text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
              >
                <Flag className="h-4 w-4" />
                {t('reportUser')}
              </button>
              <button
                type="button"
                onClick={() => handleBlockUser(peer.id)}
                className="flex w-full min-h-[40px] items-center gap-2 rounded-xl px-3 text-start text-sm text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40"
              >
                <ShieldAlert className="h-4 w-4" />
                {t('blockUser')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Top Search Bar Only */}
      <div className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 sm:p-4 shadow-sm">
        <div className="relative">
          <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search phone number or name (e.g. 01833320066)..."
            className="w-full min-h-[48px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ps-10 pe-10 text-sm sm:text-base text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute end-2.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {actionMsg && (
          <p className="mt-3 rounded-xl bg-teal-50 dark:bg-teal-950/40 px-4 py-2 text-sm text-teal-800 dark:text-teal-200">
            {actionMsg}
          </p>
        )}
      </div>

      {/* Live Search Results */}
      {trimmedQuery.length >= 2 ? (
        <section className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
          <h2 className="font-display text-base font-bold text-slate-900 dark:text-white mb-3">
            Search Results
          </h2>
          {searching ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-teal-600" />
              <span>Searching accounts...</span>
            </div>
          ) : searchError ? (
            <p className="py-6 text-center text-sm text-rose-600 dark:text-rose-400">
              {searchError}
            </p>
          ) : searchResults.length === 0 ? (
            <div className="py-8 text-center space-y-1.5">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No account found for "{trimmedQuery}"
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Make sure that person has signed in on this server with their mobile number.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {searchResults.map((person) =>
                renderPersonRow(
                  person,
                  <>
                    <span className="font-mono text-slate-600 dark:text-slate-300">
                      {person.phoneE164 || person.countryIso}
                    </span>
                    {person.showOnlineStatus && (
                      <span>· {person.online ? t('online') : t('offline')}</span>
                    )}
                  </>
                )
              )}
            </div>
          )}
        </section>
      ) : (
        /* imo-style Call History & Recent Chats Feed */
        <section className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-sm">
          <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white mb-4">
            Recent Calls & Chats
          </h2>

          {homeFeed.length === 0 && recentCalls.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <p className="font-display text-base font-semibold text-slate-800 dark:text-slate-200">
                No calls or chats yet
              </p>
              <p className="mx-auto max-w-sm text-sm text-slate-500 dark:text-slate-400">
                উপরের সার্চ বারে মোবাইল নাম্বার বা নাম লিখে খুঁজুন এবং সরাসরি অডিও, ভিডিও কল বা মেসেজ করুন।
              </p>
            </div>
          ) : homeFeed.length > 0 ? (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {homeFeed.map((item) => {
                const { peer, lastCall, lastMessage, lastActivityAt, unreadCount } = item;
                const callNewer =
                  lastCall && (!lastMessage || lastCall.startedAt >= lastMessage.createdAt);

                let subtitle: React.ReactNode = (
                  <span>{peer.phoneE164 || peer.countryIso}</span>
                );

                if (callNewer && lastCall) {
                  const isMissed = lastCall.status === 'missed' || lastCall.status === 'rejected';
                  const dur = formatDuration(lastCall.durationSec);
                  subtitle = (
                    <>
                      {isMissed ? (
                        <PhoneMissed className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      ) : lastCall.direction === 'incoming' ? (
                        <PhoneIncoming className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <PhoneOutgoing className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                      )}
                      <span className={isMissed ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}>
                        {lastCall.callType === 'video' ? 'Video call' : 'Audio call'} ·{' '}
                        {isMissed ? 'Missed' : dur || lastCall.status}
                      </span>
                    </>
                  );
                } else if (lastMessage) {
                  subtitle = (
                    <span className="truncate">
                      {lastMessage.hasImage && !lastMessage.body
                        ? '📷 Photo'
                        : lastMessage.body}
                    </span>
                  );
                }

                return renderPersonRow(
                  peer,
                  subtitle,
                  formatShortTime(lastActivityAt),
                  unreadCount
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentCalls.map((c) => {
                const peerObj: PublicUser = {
                  id: c.peerId,
                  displayName: c.peerName,
                  avatarUrl: c.peerAvatarUrl,
                  countryIso: c.peerCountryIso,
                  countryCode: '',
                  bio: '',
                  qrToken: '',
                  lastSeenAt: c.startedAt,
                };
                const isMissed = c.status === 'missed' || c.status === 'rejected';
                const dur = formatDuration(c.durationSec);
                return renderPersonRow(
                  peerObj,
                  <>
                    {isMissed ? (
                      <PhoneMissed className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                    ) : c.direction === 'incoming' ? (
                      <PhoneIncoming className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    ) : (
                      <PhoneOutgoing className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                    )}
                    <span className={isMissed ? 'text-rose-600 dark:text-rose-400 font-medium' : ''}>
                      {c.callType === 'video' ? 'Video call' : 'Audio call'} ·{' '}
                      {isMissed ? 'Missed' : dur || c.status}
                    </span>
                  </>,
                  formatShortTime(c.startedAt)
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Report Modal */}
      {reportTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <form
            onSubmit={submitReport}
            className="w-full max-w-sm rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-xl"
          >
            <h3 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {t('reportUser')}: {reportTarget.displayName}
            </h3>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white"
            >
              <option value="Harassment or spam">Harassment or spam</option>
              <option value="Impersonation">Impersonation</option>
              <option value="Abusive behavior">Abusive behavior</option>
              <option value="Safety concern">Safety concern</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 px-4 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
