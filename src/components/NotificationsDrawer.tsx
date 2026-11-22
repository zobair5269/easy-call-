import React from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import type { AppNotification } from '../types/app';

interface NotificationsDrawerProps {
  open: boolean;
  language: string;
  notifications: AppNotification[];
  onClose: () => void;
  onMarkAllRead: () => void;
}

export const NotificationsDrawer: React.FC<NotificationsDrawerProps> = ({
  open,
  language,
  notifications,
  onClose,
  onMarkAllRead,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  if (!open) return null;

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
          {notifications.length === 0 ? (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('noNotifications')}
            </p>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`p-4 ${
                  n.isRead ? '' : 'bg-teal-50/60 dark:bg-teal-950/20'
                }`}
              >
                <p className="text-sm font-semibold text-slate-900 dark:text-white">{n.title}</p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{n.body}</p>
                <p className="mt-1.5 text-xs text-slate-400 tabular-nums">
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
