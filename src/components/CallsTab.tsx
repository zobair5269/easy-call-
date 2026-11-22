import React, { useMemo, useState } from 'react';
import {
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Trash2,
  Video,
} from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import type { CallRecordItem, PublicUser } from '../types/app';
import { Avatar } from './Avatar';

interface CallsTabProps {
  language: string;
  calls: CallRecordItem[];
  onClearHistory: () => void;
  onCallback: (peer: PublicUser, callType: 'audio' | 'video') => void;
}

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const CallsTab: React.FC<CallsTabProps> = ({
  language,
  calls,
  onClearHistory,
  onCallback,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [filter, setFilter] = useState<'all' | 'incoming' | 'outgoing' | 'missed'>('all');
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    if (filter === 'all') return calls;
    if (filter === 'missed') {
      return calls.filter((c) => c.status === 'missed' || c.status === 'rejected');
    }
    return calls.filter((c) => c.direction === filter);
  }, [calls, filter]);

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-slate-900 dark:text-white">
          {t('navCalls')}
        </h2>

        {calls.length > 0 && (
          <div className="flex items-center gap-2">
            {confirmClear ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    onClearHistory();
                    setConfirmClear(false);
                  }}
                  className="min-h-[40px] rounded-xl bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[40px] rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Trash2 className="h-4 w-4 text-rose-600" />
                {t('clearHistory')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Segmented Filter Tabs */}
      <div className="grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
        {(
          [
            ['all', t('callAll')],
            ['incoming', t('callIncoming')],
            ['outgoing', t('callOutgoing')],
            ['missed', t('callMissed')],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`min-h-[42px] rounded-xl px-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap truncate ${
              filter === key
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('noCallsYet')}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {filtered.map((c) => {
            const isMissed = c.status === 'missed' || c.status === 'rejected';
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

            return (
              <div key={c.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar src={c.peerAvatarUrl} name={c.peerName} size="md" />
                  <div className="min-w-0">
                    <p
                      className={`font-semibold truncate ${
                        isMissed
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {c.peerName}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                      {isMissed ? (
                        <PhoneMissed className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      ) : c.direction === 'incoming' ? (
                        <PhoneIncoming className="h-3.5 w-3.5 text-teal-600 shrink-0" />
                      ) : (
                        <PhoneOutgoing className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                      )}
                      <span>{c.callType === 'video' ? t('videoCall') : t('audioCall')}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {new Date(c.startedAt).toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {c.durationSec > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">{formatDuration(c.durationSec)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {c.canCallback && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => onCallback(peerObj, 'audio')}
                      aria-label={`${t('callBack')} (${t('audioCall')})`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 hover:bg-teal-100 dark:hover:bg-teal-900/60"
                    >
                      <Phone className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCallback(peerObj, 'video')}
                      aria-label={`${t('callBack')} (${t('videoCall')})`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                      <Video className="h-5 w-5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
