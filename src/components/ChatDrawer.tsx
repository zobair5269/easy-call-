import React, { useEffect, useRef, useState } from 'react';
import { Check, CheckCheck, ImagePlus, Phone, Send, Video, X } from 'lucide-react';
import { translate, type TranslationKeys } from '../i18n/translations';
import { apiFetch, fileToCompressedDataUrl, resolveApiUrl } from '../lib/api';
import type { ChatMessage, PublicUser, SelfUser } from '../types/app';
import { Avatar } from './Avatar';

interface ChatDrawerProps {
  friend: PublicUser | null;
  selfUser: SelfUser;
  language: string;
  incomingMessages: ChatMessage[];
  onClose: () => void;
  onStartCall: (friend: PublicUser, type: 'audio' | 'video') => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  friend,
  selfUser,
  language,
  incomingMessages,
  onClose,
  onStartCall,
}) => {
  const t = (key: TranslationKeys) => translate(language, key);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!friend) return;
    let active = true;
    apiFetch<{ messages: ChatMessage[] }>(`/api/messages/${friend.id}`)
      .then((res) => {
        if (active) setMessages(res.messages);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load chat.');
      });
    return () => {
      active = false;
    };
  }, [friend]);

  useEffect(() => {
    if (!friend) return;
    const relevant = incomingMessages.filter(
      (m) =>
        (m.senderId === friend.id && m.receiverId === selfUser.id) ||
        (m.senderId === selfUser.id && m.receiverId === friend.id)
    );
    if (relevant.length === 0) return;
    setMessages((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      const added = relevant.filter((r) => !ids.has(r.id));
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [incomingMessages, friend, selfUser.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!friend) return null;

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{ message: ChatMessage }>(`/api/messages/${friend.id}`, {
        method: 'POST',
        body: JSON.stringify({ body: trimmed }),
      });
      setMessages((prev) => [...prev, res.message]);
      setText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send.');
    } finally {
      setSending(false);
    }
  };

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSending(true);
    setError(null);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 1024);
      const uploaded = await apiFetch<{ uploadId: string }>('/api/uploads/image', {
        method: 'POST',
        body: JSON.stringify({ dataUrl, purpose: 'chat' }),
      });
      const res = await apiFetch<{ message: ChatMessage }>(`/api/messages/${friend.id}`, {
        method: 'POST',
        body: JSON.stringify({ body: '', imageId: uploaded.uploadId }),
      });
      setMessages((prev) => [...prev, res.message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send photo.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/50 backdrop-blur-sm">
      <div className="flex h-full w-full max-w-lg flex-col bg-white dark:bg-slate-900 border-s border-slate-200 dark:border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar
              src={friend.avatarUrl}
              name={friend.displayName}
              size="md"
              online={friend.showOnlineStatus ? friend.online : undefined}
            />
            <div className="min-w-0">
              <p className="font-display font-bold text-slate-900 dark:text-white truncate">
                {friend.displayName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {friend.showOnlineStatus
                  ? friend.online
                    ? t('online')
                    : t('offline')
                  : friend.countryIso}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onStartCall(friend, 'audio')}
              aria-label={t('audioCall')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/50"
            >
              <Phone className="h-5 w-5 fill-[#1D8BF1]" />
            </button>
            <button
              type="button"
              onClick={() => onStartCall(friend, 'video')}
              aria-label={t('videoCall')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#1D8BF1] hover:bg-sky-50 dark:hover:bg-sky-950/50"
            >
              <Video className="h-5 w-5" />
            </button>
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

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50 dark:bg-slate-950">
          {messages.length === 0 && (
            <p className="py-12 text-center text-sm text-slate-500 dark:text-slate-400">
              Say hello to {friend.displayName}
            </p>
          )}
          {messages.map((m) => {
            const mine = m.senderId === selfUser.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-xs ${
                    mine
                      ? 'bg-[#1D8BF1] text-white'
                      : 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-800'
                  }`}
                >
                  {m.imageUrl && (
                    <img
                      src={resolveApiUrl(m.imageUrl)}
                      alt="Shared photo"
                      referrerPolicy="no-referrer"
                      className="mb-2 max-h-60 rounded-xl object-cover"
                    />
                  )}
                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                  <div
                    className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${
                      mine ? 'text-sky-100' : 'text-slate-400'
                    }`}
                  >
                    <span className="tabular-nums">
                      {new Date(m.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {mine &&
                      (m.status === 'read' || m.status === 'delivered' ? (
                        <CheckCheck className="h-3.5 w-3.5" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      ))}
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={endRef} />
        </div>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/50 px-4 py-2 text-xs text-rose-700 dark:text-rose-300">
            {error}
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={sendMessage}
          className="flex items-center gap-2 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 pb-safe"
        >
          <label
            title={t('shareImage')}
            className="flex min-h-[44px] min-w-[44px] cursor-pointer items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <ImagePlus className="h-5 w-5" />
            <input type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
          </label>
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('typeMessage')}
            className="flex-1 min-h-[44px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
          />
          <button
            type="submit"
            disabled={sending || !text.trim()}
            aria-label={t('send')}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-[#1D8BF1] text-white hover:bg-sky-600 disabled:opacity-50 shrink-0"
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
      </div>
    </div>
  );
};
