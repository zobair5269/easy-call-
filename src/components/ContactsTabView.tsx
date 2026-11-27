import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownAZ,
  Bell,
  Check,
  ChevronRight,
  Loader2,
  Phone,
  PhoneCall,
  QrCode,
  Search,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch } from '../lib/api';
import type { FriendRequestItem, HomeFeedItem, PublicUser, SelfUser } from '../types/app';
import { Avatar } from './Avatar';
import { formatLastSeen } from '../lib/formatLastSeen';
import type { PhotoViewerTarget } from './PhotoViewerModal';

interface ContactsTabViewProps {
  selfUser: SelfUser;
  language: string;
  friendsList: PublicUser[];
  homeFeed: HomeFeedItem[];
  incomingRequests: FriendRequestItem[];
  unreadNotificationsCount: number;
  missedCallsCount?: number;
  searchOpen: boolean;
  onCloseSearch: () => void;
  onOpenNewContacts: () => void;
  onOpenQrScanner: () => void;
  onOpenMyQr: () => void;
  onOpenCallHistory: () => void;
  onOpenNotifications: () => void;
  onOpenChat: (peer: PublicUser) => void;
  onStartCall: (peer: PublicUser, callType: 'audio' | 'video') => void;
  onRespondFriendRequest: (requestId: string, action: 'accept' | 'reject') => Promise<void> | void;
  onPreviewPhoto: (target: PhotoViewerTarget) => void;
}

const INDEX_LETTERS = ['#', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

function getBucketKey(name: string): string {
  const ch = (name || '').trim().charAt(0).toUpperCase();
  return ch >= 'A' && ch <= 'Z' ? ch : '#';
}

export const ContactsTabView: React.FC<ContactsTabViewProps> = ({
  selfUser,
  language,
  friendsList,
  homeFeed,
  incomingRequests,
  unreadNotificationsCount,
  missedCallsCount = 0,
  searchOpen,
  onCloseSearch,
  onOpenNewContacts,
  onOpenQrScanner,
  onOpenMyQr,
  onOpenCallHistory,
  onOpenNotifications,
  onOpenChat,
  onStartCall,
  onRespondFriendRequest,
  onPreviewPhoto,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [sortMode, setSortMode] = useState<'name' | 'recent'>('name');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<PublicUser[]>([]);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (searchOpen) {
      window.setTimeout(() => searchInputRef.current?.focus(), 60);
    } else {
      setQuery('');
      setSearchResults([]);
    }
  }, [searchOpen]);

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await apiFetch<{ results: PublicUser[] }>(
          `/api/users/search?q=${encodeURIComponent(trimmedQuery)}`
        );
        if (!cancelled) setSearchResults(res.results || []);
      } catch {
        // Ignore
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmedQuery]);

  // Merge connected friends + peers from recent activity
  const allContacts = useMemo(() => {
    const byId = new Map<string, PublicUser>();
    for (const f of friendsList) {
      if (f.id !== selfUser.id) byId.set(f.id, f);
    }
    for (const item of homeFeed) {
      if (item.peer.id !== selfUser.id && !byId.has(item.peer.id)) {
        byId.set(item.peer.id, item.peer);
      }
    }
    const list = Array.from(byId.values());
    if (sortMode === 'name') {
      list.sort((a, b) =>
        (a.displayName || a.phoneE164 || '').localeCompare(b.displayName || b.phoneE164 || '')
      );
    } else {
      list.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
    }
    if (trimmedQuery.length > 0) {
      const q = trimmedQuery.toLowerCase();
      return list.filter(
        (c) =>
          (c.displayName || '').toLowerCase().includes(q) ||
          (c.phoneE164 || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [friendsList, homeFeed, selfUser.id, sortMode, trimmedQuery]);

  const firstIndexByLetter = useMemo(() => {
    const map: Record<string, string> = {};
    for (const c of allContacts) {
      const bucket = getBucketKey(c.displayName || c.phoneE164 || '#');
      if (!map[bucket]) {
        map[bucket] = c.id;
      }
    }
    return map;
  }, [allContacts]);

  const jumpToLetter = (letter: string) => {
    const targetId = firstIndexByLetter[letter];
    if (!targetId) return;
    const el = rowRefs.current[targetId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="relative bg-white dark:bg-slate-900 min-h-[calc(100vh-116px)]">
      {/* Slide-down Search Bar */}
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

      {/* Pending Incoming Requests Quick Card */}
      {incomingRequests.length > 0 && (
        <div className="border-b-[8px] border-[#F3F4F6] dark:border-slate-950 px-4 py-3 bg-[#F0F8FF] dark:bg-sky-950/25 space-y-2">
          <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
            {t('friendRequests')} ({incomingRequests.length})
          </p>
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
                  className="inline-flex h-8 items-center rounded-lg border border-slate-300 dark:border-slate-700 px-2.5 text-xs font-semibold text-slate-700 dark:text-slate-200"
                >
                  {t('rejectRequest')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Global Search Matches (when searching >= 2 chars) */}
      {trimmedQuery.length >= 2 && (
        <div className="border-b-[8px] border-[#F3F4F6] dark:border-slate-950">
          <div className="px-4 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/70">
            {t('searchResults')}
          </div>
          {searching ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin text-[#1D8BF1]" />
              <span>Searching...</span>
            </div>
          ) : searchResults.length === 0 ? (
            <p className="px-4 py-4 text-xs text-slate-500 dark:text-slate-400">
              No additional EASY CALL accounts matched "{trimmedQuery}".
            </p>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {searchResults.map((person) => (
                <div
                  key={person.id}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 pe-8"
                >
                  <button
                    type="button"
                    onClick={() => onOpenChat(person)}
                    className="flex flex-1 items-center gap-3 min-w-0 text-start"
                  >
                    <Avatar src={person.avatarUrl} name={person.displayName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium text-slate-900 dark:text-white truncate">
                        {person.displayName}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {person.phoneE164 || person.countryIso}
                      </p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartCall(person, 'video')}
                      aria-label={t('videoCall')}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Video className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall(person, 'audio')}
                      aria-label={t('audioCall')}
                      className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40"
                    >
                      <Phone className="h-5 w-5 fill-[#1D8BF1]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Screenshot 1 Top Action Rows */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border-b-[8px] border-[#F3F4F6] dark:border-slate-950">
        <button
          type="button"
          onClick={onOpenNewContacts}
          className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-4 min-w-0">
            <UserPlus className="h-6 w-6 text-[#1D8BF1] shrink-0" />
            <span className="text-[15.5px] font-medium text-slate-900 dark:text-white truncate">
              New Contacts
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {incomingRequests.length > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#22C55E] px-1.5 text-[11px] font-bold text-white">
                {incomingRequests.length}
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenQrScanner}
          className="flex w-full min-h-[54px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-4 min-w-0">
            <QrCode className="h-6 w-6 text-[#1D8BF1] shrink-0" />
            <span className="text-[15.5px] font-medium text-slate-900 dark:text-white truncate">
              {t('scanQrCode')}
            </span>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
        </button>
      </div>

      {/* Screenshot 1 Colored-Circle Functional Menu Rows */}
      <div className="divide-y divide-slate-100 dark:divide-slate-800/80 border-b-[8px] border-[#F3F4F6] dark:border-slate-950">
        <button
          type="button"
          onClick={onOpenCallHistory}
          className="flex w-full min-h-[56px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E8F3FF] dark:bg-sky-950/60 text-[#1D8BF1] shrink-0">
              <PhoneCall className="h-5 w-5" />
            </span>
            <span className="text-[15.5px] font-medium text-slate-900 dark:text-white truncate">
              Call History
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {missedCallsCount > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">
                {missedCallsCount}
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-slate-400 shrink-0" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenNewContacts}
          className="flex w-full min-h-[56px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E6FBF3] dark:bg-emerald-950/60 text-[#10B981] shrink-0">
              <Users className="h-5 w-5" />
            </span>
            <span className="text-[15.5px] font-medium text-slate-900 dark:text-white truncate">
              {t('friendRequests')}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {incomingRequests.length > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#22C55E] px-1.5 text-[11px] font-bold text-white">
                {incomingRequests.length}
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </div>
        </button>

        <button
          type="button"
          onClick={onOpenNotifications}
          className="flex w-full min-h-[56px] items-center justify-between px-4 py-3 text-start hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
        >
          <div className="flex items-center gap-3.5 min-w-0">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#EEF2FF] dark:bg-indigo-950/60 text-[#6366F1] shrink-0">
              <Bell className="h-5 w-5" />
            </span>
            <span className="text-[15.5px] font-medium text-slate-900 dark:text-white truncate">
              {t('notifications')}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {unreadNotificationsCount > 0 && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-bold text-white">
                {unreadNotificationsCount}
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </div>
        </button>
      </div>

      {/* Sort Header Row */}
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <span className="text-[13.5px] text-slate-500 dark:text-slate-400">
          {sortMode === 'name' ? 'Sort by name' : 'Sort by recent'}
        </span>
        <button
          type="button"
          onClick={() => setSortMode((m) => (m === 'name' ? 'recent' : 'name'))}
          aria-label="Toggle sort order"
          title="Toggle sort order"
          className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <ArrowDownAZ className="h-5 w-5" />
        </button>
      </div>

      {/* Contacts List + A-Z Right Index Rail */}
      <div className="relative">
        <div className="divide-y divide-slate-100/90 dark:divide-slate-800/70 pe-6">
          {/* Self (You) Row matching Screenshot 1 */}
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <button
              type="button"
              onClick={onOpenMyQr}
              className="flex flex-1 items-center gap-3.5 min-w-0 text-start"
            >
              <Avatar
                src={selfUser.avatarUrl}
                name={selfUser.displayName || selfUser.phoneE164}
                size="md"
                verifiedCheck
              />
              <div className="min-w-0 flex-1">
                <p className="text-[15.5px] font-semibold text-slate-900 dark:text-white truncate">
                  {selfUser.displayName || selfUser.phoneE164} (You)
                </p>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {t('myQrCode')} · {selfUser.phoneE164}
                </p>
              </div>
            </button>
            <button
              type="button"
              onClick={onOpenMyQr}
              aria-label={t('myQrCode')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40 shrink-0"
            >
              <QrCode className="h-5 w-5" />
            </button>
          </div>

          {/* Connected Friends / Peers */}
          {allContacts.length === 0 ? (
            <div className="py-10 px-4 text-center space-y-1.5">
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No connected contacts yet
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Tap "New Contacts" or "Scan QR Code" above to add people.
              </p>
            </div>
          ) : (
            allContacts.map((person) => {
              const lastSeenLabel = formatLastSeen(person, language);
              return (
                <div
                  key={person.id}
                  ref={(el) => {
                    rowRefs.current[person.id] = el;
                  }}
                  className="flex items-center justify-between gap-2 px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                >
                  <div className="flex flex-1 items-center gap-3.5 min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        onPreviewPhoto({
                          url: person.avatarUrl,
                          name: person.displayName || person.phoneE164 || 'User',
                          subtitle: lastSeenLabel || person.phoneE164,
                        })
                      }
                      aria-label={`View ${person.displayName || 'User'} photo`}
                      className="rounded-full shrink-0 focus-visible:outline-2 focus-visible:outline-[#1D8BF1]"
                    >
                      <Avatar
                        src={person.avatarUrl}
                        name={person.displayName || person.phoneE164 || 'User'}
                        size="md"
                        verifiedCheck={person.showOnlineStatus !== false && person.online === true}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenChat(person)}
                      className="min-w-0 flex-1 text-start"
                    >
                      <p className="text-[15.5px] font-medium text-slate-900 dark:text-white truncate">
                        {person.displayName || person.phoneE164}
                      </p>
                      <p
                        className={`text-xs truncate mt-0.5 ${
                          person.online && person.showOnlineStatus !== false
                            ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {lastSeenLabel || person.phoneE164 || person.countryIso}
                      </p>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => onStartCall(person, 'audio')}
                    aria-label={`${t('audioCall')} ${person.displayName}`}
                    title={`${t('audioCall')} ${person.displayName}`}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40 shrink-0 active:scale-95 transition-transform"
                  >
                    <Phone className="h-5 w-5 fill-[#1D8BF1]" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Right A–Z Index Rail (Screenshot 1) */}
        {allContacts.length > 0 && (
          <div
            aria-label="Alphabetical index"
            className="fixed end-1 top-1/2 -translate-y-1/2 z-10 hidden sm:flex md:hidden lg:flex flex-col items-center gap-0.5 py-2 select-none"
          >
            {INDEX_LETTERS.map((letter) => {
              const hasMatch = Boolean(firstIndexByLetter[letter]);
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={!hasMatch}
                  onClick={() => jumpToLetter(letter)}
                  className={`w-4 text-[10px] leading-[13px] font-semibold text-center ${
                    hasMatch
                      ? 'text-slate-600 dark:text-slate-300 hover:text-[#1D8BF1]'
                      : 'text-slate-300 dark:text-slate-700 cursor-default'
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        )}
        {allContacts.length > 0 && (
          <div
            aria-label="Alphabetical quick jump"
            className="absolute end-1 top-2 z-10 flex sm:hidden flex-col items-center gap-[1px] select-none"
          >
            {INDEX_LETTERS.map((letter) => {
              const hasMatch = Boolean(firstIndexByLetter[letter]);
              return (
                <button
                  key={letter}
                  type="button"
                  disabled={!hasMatch}
                  onClick={() => jumpToLetter(letter)}
                  className={`w-4 text-[9.5px] leading-[12px] font-semibold text-center ${
                    hasMatch
                      ? 'text-slate-600 dark:text-slate-300 active:text-[#1D8BF1]'
                      : 'text-slate-300 dark:text-slate-700'
                  }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
