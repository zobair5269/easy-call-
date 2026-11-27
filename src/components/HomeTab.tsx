import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Loader2,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Plus,
  QrCode,
  Search,
  UserPlus,
  Video,
  X,
} from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch } from '../lib/api';
import type {
  CallRecordItem,
  FriendRequestItem,
  HomeFeedItem,
  PublicUser,
  SelfUser,
} from '../types/app';
import { Avatar } from './Avatar';
import { formatLastSeen } from '../lib/formatLastSeen';
import type { PhotoViewerTarget } from './PhotoViewerModal';

interface HomeTabProps {
  selfUser: SelfUser;
  language: string;
  homeFeed: HomeFeedItem[];
  recentCalls: CallRecordItem[];
  friendsList: PublicUser[];
  incomingRequests?: FriendRequestItem[];
  searchOpen: boolean;
  onCloseSearch: () => void;
  onRespondFriendRequest?: (requestId: string, action: 'accept' | 'reject') => Promise<void> | void;
  onStartCall: (peer: PublicUser, callType: 'audio' | 'video') => void;
  onOpenChat: (peer: PublicUser) => void;
  onOpenQrScanner: () => void;
  onOpenMe: () => void;
  onPreviewPhoto: (target: PhotoViewerTarget) => void;
}

function formatImoTimestamp(ts: number): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 7) {
      return d.toLocaleDateString([], { weekday: 'short' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export const HomeTab: React.FC<HomeTabProps> = ({
  selfUser,
  language,
  homeFeed,
  recentCalls,
  friendsList,
  incomingRequests = [],
  searchOpen,
  onCloseSearch,
  onRespondFriendRequest,
  onStartCall,
  onOpenChat,
  onOpenQrScanner,
  onOpenMe,
  onPreviewPhoto,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (searchOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 60);
    } else {
      setQuery('');
      setSearchResults([]);
      setSearchError(null);
    }
  }, [searchOpen]);

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

  // Quick-access contact strip combining feed peers (with unread badges) and connected friends
  const quickStripPeers = useMemo(() => {
    const seen = new Set<string>([selfUser.id]);
    const list: Array<{ peer: PublicUser; unreadCount: number }> = [];
    for (const item of homeFeed) {
      if (!seen.has(item.peer.id)) {
        seen.add(item.peer.id);
        list.push({ peer: item.peer, unreadCount: item.unreadCount });
      }
    }
    for (const friend of friendsList) {
      if (!seen.has(friend.id)) {
        seen.add(friend.id);
        list.push({ peer: friend, unreadCount: 0 });
      }
    }
    return list.slice(0, 14);
  }, [homeFeed, friendsList, selfUser.id]);

  return (
    <div className="bg-white dark:bg-slate-900 min-h-[calc(100vh-116px)]">
      {/* Slide-down Live Search Bar (activated via bottom-right Search icon) */}
      {(searchOpen || trimmedQuery.length > 0) && (
        <div className="border-b border-slate-100 dark:border-slate-800 px-4 py-2.5 bg-slate-50/80 dark:bg-slate-950/60">
          <div className="relative flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('searchPlaceholder')}
                className="w-full h-10 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 ps-9 pe-8 text-sm text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute end-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setQuery('');
                onCloseSearch();
              }}
              className="text-sm font-medium text-[#1D8BF1] px-2 py-1 whitespace-nowrap"
            >
              {t('close')}
            </button>
          </div>
        </div>
      )}

      {/* Pending Friend Requests Banner */}
      {incomingRequests.length > 0 && onRespondFriendRequest && (
        <div className="border-b-[8px] border-[#F3F4F6] dark:border-slate-950 px-4 py-3 bg-[#F0F8FF] dark:bg-sky-950/25 space-y-2.5">
          <div className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-[#1D8BF1]" />
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              {t('friendRequests')} ({incomingRequests.length})
            </span>
          </div>
          <div className="space-y-2">
            {incomingRequests.map((req) => (
              <div
                key={req.requestId}
                className="flex items-center justify-between gap-2 rounded-xl bg-white dark:bg-slate-900 px-3 py-2 border border-slate-200/80 dark:border-slate-800"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={req.user.avatarUrl} name={req.user.displayName} size="xs" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                      {req.user.displayName}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {req.user.phoneE164 || req.user.countryIso}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={respondingId === req.requestId}
                    onClick={async () => {
                      setRespondingId(req.requestId);
                      try {
                        await onRespondFriendRequest(req.requestId, 'accept');
                      } finally {
                        setRespondingId(null);
                      }
                    }}
                    className="inline-flex h-8 items-center gap-1 rounded-lg bg-[#1D8BF1] px-2.5 text-xs font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" />
                    {t('acceptRequest')}
                  </button>
                  <button
                    type="button"
                    disabled={respondingId === req.requestId}
                    onClick={async () => {
                      setRespondingId(req.requestId);
                      try {
                        await onRespondFriendRequest(req.requestId, 'reject');
                      } finally {
                        setRespondingId(null);
                      }
                    }}
                    className="inline-flex h-8 items-center rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    {t('rejectRequest')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Results Mode */}
      {trimmedQuery.length >= 2 ? (
        <div>
          {searching ? (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin text-[#1D8BF1]" />
              <span>Searching accounts...</span>
            </div>
          ) : searchError ? (
            <p className="py-10 text-center text-sm text-rose-600 dark:text-rose-400 px-4">
              {searchError}
            </p>
          ) : searchResults.length === 0 ? (
            <div className="py-12 text-center px-4 space-y-1">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                No account found for "{trimmedQuery}"
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Search by mobile number or registered EASY CALL display name.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {searchResults.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <button
                    type="button"
                    onClick={() => onOpenChat(person)}
                    className="flex flex-1 items-center gap-3 min-w-0 text-start"
                  >
                    <Avatar
                      src={person.avatarUrl}
                      name={person.displayName || person.phoneE164 || 'User'}
                      size="md"
                      verifiedCheck={person.showOnlineStatus && person.online}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-[15.5px] font-semibold text-slate-900 dark:text-white truncate">
                        {person.displayName || person.phoneE164}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        {person.phoneE164 || person.countryIso}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartCall(person, 'video')}
                      aria-label={`${t('videoCall')} ${person.displayName}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Video className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall(person, 'audio')}
                      aria-label={`${t('audioCall')} ${person.displayName}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40"
                    >
                      <Phone className="h-5 w-5 fill-[#1D8BF1]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Screenshot 3 Horizontal Quick Strip */}
          <div className="flex items-start gap-4 overflow-x-auto px-4 py-3 border-b border-slate-100 dark:border-slate-800/80 no-scrollbar">
            {/* Scan QR / Add Contact Tile */}
            <button
              type="button"
              onClick={onOpenQrScanner}
              className="flex flex-col items-center gap-1.5 w-[62px] shrink-0 group"
            >
              <div className="relative flex h-[50px] w-[50px] items-center justify-center rounded-full bg-[#F2F4F7] dark:bg-slate-800 text-slate-800 dark:text-slate-100 group-active:scale-95 transition-transform">
                <QrCode className="h-6 w-6" />
                <span className="absolute -bottom-0.5 -end-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-[#1D8BF1] text-white border-2 border-white dark:border-slate-900">
                  <Plus className="h-3 w-3 stroke-[3]" />
                </span>
              </div>
              <span className="text-[11.5px] text-slate-600 dark:text-slate-300 truncate w-full text-center">
                {t('scanQrCode')}
              </span>
            </button>

            {/* Self Profile Tile */}
            <button
              type="button"
              onClick={onOpenMe}
              className="flex flex-col items-center gap-1.5 w-[62px] shrink-0 group"
            >
              <div className="relative">
                <Avatar
                  src={selfUser.avatarUrl}
                  name={selfUser.displayName || selfUser.phoneE164}
                  size="md"
                  online={true}
                />
              </div>
              <span className="text-[11.5px] text-slate-600 dark:text-slate-300 truncate w-full text-center">
                {selfUser.displayName?.split(' ')[0] || 'You'}
              </span>
            </button>

            {/* Connected Contacts / Recent Active Circles */}
            {quickStripPeers.map(({ peer, unreadCount }) => (
              <button
                key={peer.id}
                type="button"
                onClick={() => onOpenChat(peer)}
                className="flex flex-col items-center gap-1.5 w-[62px] shrink-0 group"
              >
                <div className="relative">
                  <Avatar
                    src={peer.avatarUrl}
                    name={peer.displayName || peer.phoneE164 || 'User'}
                    size="md"
                    online={peer.showOnlineStatus ? peer.online : undefined}
                  />
                  {unreadCount > 0 && (
                    <span className="absolute -top-0.5 -end-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#22C55E] px-1 text-[11px] font-bold text-white border-2 border-white dark:border-slate-900">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-[11.5px] text-slate-600 dark:text-slate-300 truncate w-full text-center">
                  {peer.displayName || peer.phoneE164}
                </span>
              </button>
            ))}
          </div>

          {/* Screenshot 3 Main Call & Chat Feed */}
          {homeFeed.length === 0 && recentCalls.length === 0 ? (
            <div className="py-16 px-6 text-center space-y-2.5">
              <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
                No calls or chats yet
              </p>
              <p className="mx-auto max-w-xs text-xs text-slate-500 dark:text-slate-400">
                নিচের সার্চ আইকনে চাপ দিয়ে মোবাইল নাম্বার বা নাম খুঁজুন, অথবা + থেকে নতুন কন্টাক্ট অ্যাড করে কল ও চ্যাট শুরু করুন।
              </p>
            </div>
          ) : homeFeed.length > 0 ? (
            <div className="divide-y divide-slate-100/90 dark:divide-slate-800/70">
              {homeFeed.map((item) => {
                const { peer, lastCall, lastMessage, lastActivityAt, unreadCount } = item;
                const missedCount = item.missedCount || 0;
                const callNewer =
                  lastCall && (!lastMessage || lastCall.startedAt >= lastMessage.createdAt);

                let subtitleNode: React.ReactNode = (
                  <span className="truncate text-slate-500 dark:text-slate-400">
                    {formatLastSeen(peer, language) || peer.phoneE164 || peer.countryIso}
                  </span>
                );

                if ((callNewer && lastCall) || (missedCount > 0 && !lastMessage)) {
                  const isCanceled = lastCall?.status === 'cancelled';
                  const isMissed =
                    missedCount > 0 ||
                    lastCall?.status === 'missed' ||
                    lastCall?.status === 'rejected';
                  const label = isCanceled
                    ? 'Canceled'
                    : isMissed
                    ? missedCount > 1
                      ? `Missed call (${missedCount})`
                      : 'Missed call'
                    : lastCall?.callType === 'video'
                    ? 'Video Call'
                    : 'Audio Call';

                  subtitleNode = (
                    <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400 truncate">
                      {isMissed ? (
                        <PhoneMissed className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      ) : lastCall?.direction === 'incoming' ? (
                        <PhoneIncoming className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      ) : (
                        <PhoneOutgoing className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                      )}
                      <span className={isMissed ? 'text-rose-500 dark:text-rose-400 font-medium' : ''}>
                        {label}
                      </span>
                    </span>
                  );
                } else if (lastMessage) {
                  subtitleNode = (
                    <span className="truncate text-slate-500 dark:text-slate-400">
                      {lastMessage.hasImage && !lastMessage.body ? '📷 Photo' : lastMessage.body}
                    </span>
                  );
                }

                return (
                  <div
                    key={peer.id}
                    className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <div className="flex flex-1 items-center gap-3.5 min-w-0">
                      <button
                        type="button"
                        onClick={() =>
                          onPreviewPhoto({
                            url: peer.avatarUrl,
                            name: peer.displayName || peer.phoneE164 || 'User',
                            subtitle: formatLastSeen(peer, language),
                          })
                        }
                        aria-label={`View ${peer.displayName || 'User'} photo`}
                        className="rounded-full shrink-0 focus-visible:outline-2 focus-visible:outline-[#1D8BF1]"
                      >
                        <Avatar
                          src={peer.avatarUrl}
                          name={peer.displayName || peer.phoneE164 || 'User'}
                          size="md"
                          verifiedCheck={peer.showOnlineStatus !== false && peer.online === true}
                        />
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenChat(peer)}
                        className="min-w-0 flex-1 text-start"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[15.5px] font-semibold text-slate-900 dark:text-white truncate">
                            {peer.displayName || peer.phoneE164}
                          </p>
                          <span className="text-[12px] text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                            {formatImoTimestamp(lastActivityAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-[13.5px] min-w-0">
                          <div className="truncate min-w-0">{subtitleNode}</div>
                          <div className="flex items-center gap-1 shrink-0">
                            {missedCount > 0 && (
                              <span
                                title={`${missedCount} missed call(s)`}
                                className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white"
                              >
                                {missedCount}
                              </span>
                            )}
                            {unreadCount > 0 && (
                              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#22C55E] px-1.5 text-[11px] font-bold text-white">
                                {unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => onStartCall(peer, 'audio')}
                      aria-label={`${t('audioCall')} ${peer.displayName}`}
                      title={`${t('audioCall')} ${peer.displayName}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40 shrink-0 active:scale-95 transition-transform"
                    >
                      <Phone className="h-5 w-5 fill-[#1D8BF1]" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="divide-y divide-slate-100/90 dark:divide-slate-800/70">
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
                const isCanceled = c.status === 'cancelled';
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenChat(peerObj)}
                      className="flex flex-1 items-center gap-3.5 min-w-0 text-start"
                    >
                      <Avatar src={c.peerAvatarUrl} name={c.peerName} size="md" verifiedCheck />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[15.5px] font-semibold text-slate-900 dark:text-white truncate">
                            {c.peerName}
                          </p>
                          <span className="text-[12px] text-slate-400 dark:text-slate-500 shrink-0 tabular-nums">
                            {formatImoTimestamp(c.startedAt)}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[13.5px] text-slate-500 dark:text-slate-400">
                          {isMissed ? (
                            <PhoneMissed className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                          ) : c.direction === 'incoming' ? (
                            <PhoneIncoming className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          ) : (
                            <PhoneOutgoing className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className={isMissed ? 'text-rose-500 dark:text-rose-400' : ''}>
                            {isCanceled
                              ? 'Canceled'
                              : isMissed
                              ? 'Missed'
                              : c.callType === 'video'
                              ? 'Video Call'
                              : 'Audio Call'}
                          </span>
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onStartCall(peerObj, 'audio')}
                      aria-label={`${t('audioCall')} ${c.peerName}`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40 shrink-0"
                    >
                      <Phone className="h-5 w-5 fill-[#1D8BF1]" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};
