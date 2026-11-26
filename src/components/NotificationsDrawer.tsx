import React, { useState } from 'react';
import { Bell, Check, CheckCheck, X } from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import type { AppNotification, FriendRequestItem } from '../types/app';
import { Avatar } from './Avatar';

interface NotificationsDrawerProps {
  open: boolean;
  language: string;
  notifications: AppNotification[];
  incomingRequests?: FriendRequestItem[];
  onClose: () => void;
  onMarkAllRead: () => void;
  onRespondFriendRequest?: (requestId: string, action: 'accept' | 'reject') => Promise<void> | void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  open,
  language,
  notifications,
  incomingRequests = [],
  onClose,
  onMarkAllRead,
  onRespondFriendRequest,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!open) return null;

  const handleRespond = async (requestId: string, action: 'accept' | 'reject') => {
    if (!onRespondFriendRequest || busyId) return;
    setBusyId(requestId);
    try {
      await onRespondFriendRequest(requestId, action);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-md flex-col bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-teal-700 dark:text-teal-400" />
            <h2 className="font-display text-lg font-bold text-slate-900 dark:text-white">
              {t('notifications')}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {notifications.some((n) => !n.isRead) && (
              <button
                type="button"
                onClick={onMarkAllRead}
                className="inline-flex min-h-[40px] items-center gap-1 rounded-xl px-3 text-xs font-semibold text-teal-700 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-950/50"
              >
                <CheckCheck className="h-4 w-4" />
                {t('markAllRead')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={t('close')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {incomingRequests.length > 0 && (
            <div className="p-4 space-y-3 bg-teal-50/50 dark:bg-teal-950/20">
              <p className="text-xs font-bold uppercase tracking-wide text-teal-800 dark:text-teal-300">
                {t('friendRequests')} ({incomingRequests.length})
              </p>
              <div className="space-y-2.5">
                {incomingRequests.map((req) => (
                  <div
                    key={req.requestId}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-teal-200/80 dark:border-teal-900 bg-white dark:bg-slate-900 p-3 shadow-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar src={req.user.avatarUrl} name={req.user.displayName} size="md" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">
                          {req.user.displayName}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {req.user.phoneE164 || req.user.countryIso}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={busyId === req.requestId}
                        onClick={() => handleRespond(req.requestId, 'accept')}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t('acceptRequest')}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === req.requestId}
                        onClick={() => handleRespond(req.requestId, 'reject')}
                        className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        {t('rejectRequest')}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {notifications.length === 0 && incomingRequests.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('noNotifications')}
            </p>
          ) : (
            notifications.map((n) => {
              const matchingReq =
                n.type === 'friend_request' && n.relatedUserId
                  ? incomingRequests.find((r) => r.user.id === n.relatedUserId)
                  : undefined;
              return (
                <div
                  key={n.id}
                  className={`p-4 ${
                    n.isRead ? '' : 'bg-teal-50/60 dark:bg-teal-950/20'
                  }`}
                >
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</p>
                  <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{n.body}</p>
                  {matchingReq && onRespondFriendRequest && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        disabled={busyId === matchingReq.requestId}
                        onClick={() => handleRespond(matchingReq.requestId, 'accept')}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-xl bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
                      >
                        <Check className="h-3.5 w-3.5" />
                        {t('acceptRequest')}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === matchingReq.requestId}
                        onClick={() => handleRespond(matchingReq.requestId, 'reject')}
                        className="inline-flex min-h-[36px] items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                        {t('rejectRequest')}
                      </button>
                    </div>
                  )}
                  <p className="mt-1.5 text-xs text-slate-400 tabular-nums">
                    {new Date(n.createdAt).toLocaleString()}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

