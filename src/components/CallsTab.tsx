import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
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
  onBack?: () => void;
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
  onBack,
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
    <div className="bg-white dark:bg-slate-900 min-h-[calc(100vh-116px)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 px-4 py-3">
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
            Call History
          </h2>
        </div>

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
                  className="min-h-[36px] rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-700"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="min-h-[36px] rounded-lg border border-slate-300 dark:border-slate-700 px-3 text-xs font-medium text-slate-700 dark:text-slate-300"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-600" />
                {t('clearHistory')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Segmented Filter Tabs */}
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-slate-100 dark:bg-slate-800 p-1">
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
              className={`min-h-[36px] rounded-lg px-2 text-xs font-semibold transition-colors whitespace-nowrap truncate ${
                filter === key
                  ? 'bg-white dark:bg-slate-900 text-[#1D8BF1] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center px-4">
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{t('noCallsYet')}</p>
        </div>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
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
              <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <Avatar src={c.peerAvatarUrl} name={c.peerName} size="md" />
                  <div className="min-w-0">
                    <p
                      className={`text-[15.5px] font-semibold truncate ${
                        isMissed
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-slate-900 dark:text-white'
                      }`}
                    >
                      {c.peerName}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      {isMissed ? (
                        <PhoneMissed className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      ) : c.direction === 'incoming' ? (
                        <PhoneIncoming className="h-3.5 w-3.5 text-[#22C55E] shrink-0" />
                      ) : (
                        <PhoneOutgoing className="h-3.5 w-3.5 text-[#1D8BF1] shrink-0" />
                      )}
                      <span className="whitespace-nowrap">
                        {c.callType === 'video' ? t('videoCall') : t('audioCall')}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums whitespace-nowrap">
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
                          <span className="font-mono tabular-nums whitespace-nowrap">
                            {formatDuration(c.durationSec)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {c.canCallback && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onCallback(peerObj, 'video')}
                      aria-label={`${t('callBack')} (${t('videoCall')})`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Video className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onCallback(peerObj, 'audio')}
                      aria-label={`${t('callBack')} (${t('audioCall')})`}
                      className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/40"
                    >
                      <Phone className="h-5 w-5 fill-[#1D8BF1]" />
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
