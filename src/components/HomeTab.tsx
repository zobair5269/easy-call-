import React, { useMemo, useState } from 'react';
import {
  Flag,
  MessageSquare,
  MoreVertical,
  Phone,
  QrCode,
  Search,
  ShieldAlert,
  UserMinus,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch } from '../lib/api';
import type { CallRecordItem, FriendRequestItem, PublicUser } from '../types/app';
import { Avatar } from './Avatar';

interface HomeTabProps {
  language: string;
  friends: PublicUser[];
  incomingRequests: FriendRequestItem[];
  recentCalls: CallRecordItem[];
  onStartCall: (friend: PublicUser, callType: 'audio' | 'video') => void;
  onOpenChat: (friend: PublicUser) => void;
  onOpenQr: () => void;
  onOpenContacts: () => void;
  onOpenCalls: () => void;
  onRefreshAll: () => void;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  language,
  friends,
  incomingRequests,
  recentCalls,
  onStartCall,
  onOpenChat,
  onOpenQr,
  onOpenContacts,
  onOpenCalls,
  onRefreshAll,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [filter, setFilter] = useState('');
  const [menuFriendId, setMenuFriendId] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<PublicUser | null>(null);
  const [reportReason, setReportReason] = useState('Harassment or spam');
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const visibleFriends = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        f.displayName.toLowerCase().includes(q) ||
        (f.phoneE164 && f.phoneE164.toLowerCase().includes(q))
    );
  }, [friends, filter]);

  const handleRemoveFriend = async (friendId: string) => {
    setMenuFriendId(null);
    await apiFetch(`/api/friends/${friendId}`, { method: 'DELETE' }).catch(() => {});
    onRefreshAll();
  };

  const handleBlockFriend = async (friendId: string) => {
    setMenuFriendId(null);
    await apiFetch('/api/blocks', {
      method: 'POST',
      body: JSON.stringify({ userId: friendId }),
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

  return (
    <div className="space-y-6">
      {/* Quick Search & Action Strip */}
      <div className="rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 space-y-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('searchPlaceholder')}
              className="w-full min-h-[48px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 ps-10 pe-4 text-sm sm:text-base text-slate-900 dark:text-white focus:border-teal-600 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenQr}
              className="inline-flex min-h-[48px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 text-sm font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
            >
              <QrCode className="h-4 w-4 text-teal-700 dark:text-teal-400" />
              {t('scanQr')}
            </button>
            <button
              type="button"
              onClick={onOpenContacts}
              className="inline-flex min-h-[48px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-teal-700 to-emerald-700 px-4 text-sm font-semibold text-white hover:from-teal-800 hover:to-emerald-800 shadow-xs whitespace-nowrap"
            >
              <Users className="h-4 w-4" />
              {t('syncContacts')}
            </button>
          </div>
        </div>

        {incomingRequests.length > 0 && (
          <button
            type="button"
            onClick={onOpenContacts}
            className="flex w-full min-h-[48px] items-center justify-between rounded-2xl border border-teal-200 dark:border-teal-900 bg-teal-50 dark:bg-teal-950/40 px-4 py-3 text-start hover:bg-teal-100/70 dark:hover:bg-teal-950/60 transition-colors"
          >
            <span className="flex items-center gap-2.5 text-sm font-semibold text-teal-900 dark:text-teal-200">
              <UserPlus className="h-5 w-5 text-teal-700 dark:text-teal-400" />
              {t('friendRequests')} ({incomingRequests.length})
            </span>
            <span className="text-xs font-semibold text-teal-700 dark:text-teal-300">Review</span>
          </button>
        )}

        {actionMsg && (
          <p className="rounded-xl bg-teal-50 dark:bg-teal-950/40 px-4 py-2 text-sm text-teal-800 dark:text-teal-200">
            {actionMsg}
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Primary Friends List */}
        <section className="lg:col-span-8 rounded-3xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
              {t('friendsTitle')} ({friends.length})
            </h2>
          </div>

          {visibleFriends.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="font-display text-base font-semibold text-slate-800 dark:text-slate-200">
                {t('noFriendsYet')}
              </p>
              <p className="mx-auto max-w-sm text-sm text-slate-500 dark:text-slate-400">
                {t('noFriendsHint')}
              </p>
              <div className="pt-2 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={onOpenContacts}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-gradient-to-r from-teal-700 to-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:from-teal-800 hover:to-emerald-800 shadow-xs"
                >
                  <UserPlus className="h-4 w-4" />
                  {t('sendRequest')}
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleFriends.map((friend) => (
                <div
                  key={friend.id}
                  className="relative flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <Avatar
                      src={friend.avatarUrl}
                      name={friend.displayName}
                      size="md"
                      online={friend.showOnlineStatus ? friend.online : undefined}
                    />
                    <div className="min-w-0">
                      <p className="font-display text-base font-bold text-slate-900 dark:text-white truncate">
                        {friend.displayName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {friend.showOnlineStatus
                          ? friend.online
                            ? t('online')
                            : t('offline')
                          : friend.countryIso}
                        {friend.bio ? ` · ${friend.bio}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Large accessible Audio, Video, Chat & More buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartCall(friend, 'audio')}
                      aria-label={`${t('audioCall')} ${friend.displayName}`}
                      title={t('audioCall')}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-700 to-emerald-700 px-3.5 py-2 text-sm font-semibold text-white hover:from-teal-800 hover:to-emerald-800 shadow-xs transition-all"
                    >
                      <Phone className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('audioCall')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onStartCall(friend, 'video')}
                      aria-label={`${t('videoCall')} ${friend.displayName}`}
                      title={t('videoCall')}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 dark:hover:bg-slate-600 shadow-xs transition-all"
                    >
                      <Video className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('videoCall')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenChat(friend)}
                      aria-label={`${t('message')} ${friend.displayName}`}
                      title={t('message')}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <MessageSquare className="h-5 w-5" />
                    </button>

                    <div className="relative">
                      <button
                        type="button"
                        onClick={() =>
                          setMenuFriendId((prev) => (prev === friend.id ? null : friend.id))
                        }
                        aria-label="More options"
                        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>

                      {menuFriendId === friend.id && (
                        <div className="absolute end-0 z-20 mt-1 w-48 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5 shadow-xl">
                          <button
                            type="button"
                            onClick={() => handleRemoveFriend(friend.id)}
                            className="flex w-full min-h-[40px] items-center gap-2 rounded-xl px-3 text-start text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            <UserMinus className="h-4 w-4" />
                            {t('removeFriend')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setMenuFriendId(null);
                              setReportTarget(friend);
                            }}
                            className="flex w-full min-h-[40px] items-center gap-2 rounded-xl px-3 text-start text-sm text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                          >
                            <Flag className="h-4 w-4" />
                            {t('reportUser')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleBlockFriend(friend.id)}
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
              ))}
            </div>
          )}
        </section>

        {/* Recent Calls Column */}
        <section className="lg:col-span-4 rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {t('navCalls')}
            </h2>
            {recentCalls.length > 0 && (
              <button
                type="button"
                onClick={onOpenCalls}
                className="text-xs font-semibold text-teal-700 dark:text-teal-400 hover:underline"
              >
                View all
              </button>
            )}
          </div>

          {recentCalls.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('noCallsYet')}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {recentCalls.slice(0, 5).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar src={c.peerAvatarUrl} name={c.peerName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                        {c.peerName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {c.direction} · {c.status}
                      </p>
                    </div>
                  </div>
                  {c.canCallback && (
                    <button
                      type="button"
                      onClick={() =>
                        onStartCall(
                          {
                            id: c.peerId,
                            displayName: c.peerName,
                            avatarUrl: c.peerAvatarUrl,
                            countryIso: c.peerCountryIso,
                            countryCode: '',
                            bio: '',
                            qrToken: '',
                            lastSeenAt: c.startedAt,
                          },
                          c.callType
                        )
                      }
                      aria-label={t('callBack')}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/40"
                    >
                      {c.callType === 'video' ? (
                        <Video className="h-4 w-4" />
                      ) : (
                        <Phone className="h-4 w-4" />
                      )}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

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
