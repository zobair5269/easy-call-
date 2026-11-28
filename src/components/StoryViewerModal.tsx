import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Plus,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { apiFetch, resolveApiUrl } from '../lib/api';
import type { SelfUser, StoryAuthorGroup, StoryItem } from '../types/app';
import { Avatar } from './Avatar';

interface StoryViewerModalProps {
  target: 'self' | string | null;
  selfUser: SelfUser;
  myStories: StoryItem[];
  storyGroups: StoryAuthorGroup[];
  onClose: () => void;
  onAddMoreStory: () => void;
  onRefreshStories: () => Promise<void> | void;
}

function formatStoryAgo(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'এইমাত্র';
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins} মিঃ আগে`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} ঘণ্টা আগে`;
}

export const StoryViewerModal: React.FC<StoryViewerModalProps> = ({
  target,
  selfUser,
  myStories,
  storyGroups,
  onClose,
  onAddMoreStory,
  onRefreshStories,
}) => {
  const sequences = useMemo(() => {
    if (!target) return [];
    if (target === 'self') {
      if (myStories.length === 0) return [];
      return [
        {
          id: selfUser.id,
          name: selfUser.displayName || selfUser.phoneE164,
          avatarUrl: selfUser.avatarUrl,
          isSelf: true,
          relationLabel: 'আমার স্টোরি',
          stories: myStories,
        },
      ];
    }
    return storyGroups.map((g) => ({
      id: g.author.id,
      name: g.author.displayName || g.author.phoneE164 || 'User',
      avatarUrl: g.author.avatarUrl,
      isSelf: false,
      relationLabel: g.relation === 'friend_of_friend' ? 'ফ্রেন্ডস অফ ফ্রেন্ড' : 'ফ্রেন্ড',
      stories: g.stories,
    }));
  }, [target, selfUser, myStories, storyGroups]);

  const initialSeqIdx = useMemo(() => {
    if (!target || target === 'self') return 0;
    const idx = sequences.findIndex((s) => s.id === target);
    return idx >= 0 ? idx : 0;
  }, [target, sequences]);

  const [seqIdx, setSeqIdx] = useState(initialSeqIdx);
  const [itemIdx, setItemIdx] = useState(0);
  const [muted, setMuted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const viewedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!target) return;
    setSeqIdx(initialSeqIdx);
    const chosen = sequences[initialSeqIdx];
    if (chosen && !chosen.isSelf) {
      const firstUnread = chosen.stories.findIndex((st) => !st.viewedByMe);
      setItemIdx(firstUnread >= 0 ? firstUnread : 0);
    } else {
      setItemIdx(0);
    }
  }, [target, initialSeqIdx]);

  const currentSeq = sequences[seqIdx];
  const currentStory = currentSeq?.stories[itemIdx];

  const goNext = useCallback(() => {
    if (!currentSeq) {
      onClose();
      return;
    }
    if (itemIdx + 1 < currentSeq.stories.length) {
      setItemIdx((i) => i + 1);
      return;
    }
    if (seqIdx + 1 < sequences.length) {
      const nextSeq = sequences[seqIdx + 1];
      setSeqIdx((s) => s + 1);
      const firstUnread = nextSeq.stories.findIndex((st) => !st.viewedByMe);
      setItemIdx(firstUnread >= 0 ? firstUnread : 0);
      return;
    }
    onClose();
  }, [currentSeq, itemIdx, seqIdx, sequences, onClose]);

  const goPrev = useCallback(() => {
    if (itemIdx > 0) {
      setItemIdx((i) => i - 1);
      return;
    }
    if (seqIdx > 0) {
      const prevSeq = sequences[seqIdx - 1];
      setSeqIdx((s) => s - 1);
      setItemIdx(Math.max(0, prevSeq.stories.length - 1));
    }
  }, [itemIdx, seqIdx, sequences]);

  // Mark viewed on backend
  useEffect(() => {
    if (!target || !currentSeq || !currentStory || currentSeq.isSelf) return;
    if (currentStory.viewedByMe || viewedIdsRef.current.has(currentStory.id)) return;
    viewedIdsRef.current.add(currentStory.id);
    apiFetch(`/api/stories/${encodeURIComponent(currentStory.id)}/view`, {
      method: 'POST',
    })
      .then(() => onRefreshStories())
      .catch(() => {});
  }, [target, currentSeq, currentStory, onRefreshStories]);

  // Auto-advance for text and image stories
  useEffect(() => {
    if (!target || !currentStory || currentStory.mediaType === 'video') return;
    const timer = window.setTimeout(() => {
      goNext();
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [target, currentStory, goNext]);

  if (!target || !currentSeq || !currentStory) return null;

  const handleDeleteCurrent = async () => {
    if (!currentSeq.isSelf || deleting) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/stories/${encodeURIComponent(currentStory.id)}`, {
        method: 'DELETE',
      });
      await onRefreshStories();
      if (currentSeq.stories.length <= 1) {
        onClose();
      } else if (itemIdx >= currentSeq.stories.length - 1) {
        setItemIdx(Math.max(0, currentSeq.stories.length - 2));
      }
    } catch {
      // Ignore transient delete errors
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black text-white">
      <div className="relative flex h-full w-full max-w-md flex-col justify-between overflow-hidden bg-slate-950">
        {/* Progress Bars */}
        <div className="relative z-20 px-3 pt-safe">
          <div className="flex gap-1.5 pt-2.5">
            {currentSeq.stories.map((st, idx) => (
              <div
                key={st.id}
                className="h-1 flex-1 overflow-hidden rounded-full bg-white/30"
              >
                <div
                  className={`h-full rounded-full bg-white transition-all ${
                    idx < itemIdx ? 'w-full' : idx === itemIdx ? 'w-full opacity-95' : 'w-0'
                  }`}
                />
              </div>
            ))}
          </div>

          {/* Author Header */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar src={currentSeq.avatarUrl} name={currentSeq.name} size="xs" />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold text-white">{currentSeq.name}</p>
                  <span className="rounded-md bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-white/90">
                    {currentSeq.relationLabel}
                  </span>
                </div>
                <p className="text-[11px] text-white/75">
                  {formatStoryAgo(currentStory.createdAt)} ·{' '}
                  {currentStory.visibility === 'friends_of_friends'
                    ? 'ফ্রেন্ডস অফ ফ্রেন্ড'
                    : 'ফ্রেন্ড'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {currentStory.mediaType === 'video' && (
                <button
                  type="button"
                  onClick={() => setMuted((m) => !m)}
                  aria-label={muted ? 'Unmute' : 'Mute'}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
                >
                  {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                </button>
              )}
              {currentSeq.isSelf && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onAddMoreStory();
                    }}
                    aria-label="Add story"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteCurrent}
                    disabled={deleting}
                    aria-label="Delete story"
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-rose-400 hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close story viewer"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Media / Text Body */}
        <div
          style={
            currentStory.mediaType === 'text'
              ? { backgroundColor: currentStory.bgStyle || '#1D8BF1' }
              : undefined
          }
          className="absolute inset-0 flex items-center justify-center"
        >
          {currentStory.mediaType === 'text' && (
            <p className="px-8 text-center text-2xl font-bold leading-snug text-white whitespace-pre-wrap break-words">
              {currentStory.textContent}
            </p>
          )}

          {currentStory.mediaType === 'image' && currentStory.mediaUrl && (
            <img
              src={resolveApiUrl(currentStory.mediaUrl)}
              alt={currentStory.textContent || 'Story photo'}
              className="max-h-full max-w-full object-contain"
            />
          )}

          {currentStory.mediaType === 'video' && currentStory.mediaUrl && (
            <video
              key={currentStory.id}
              src={resolveApiUrl(currentStory.mediaUrl)}
              autoPlay
              playsInline
              muted={muted}
              onEnded={goNext}
              className="max-h-full max-w-full object-contain"
            />
          )}
        </div>

        {/* Left / Right Tap Areas */}
        <button
          type="button"
          onClick={goPrev}
          aria-label="Previous story"
          className="absolute inset-y-20 start-0 z-10 w-1/3 flex items-center justify-start ps-2 opacity-0 hover:opacity-100 transition-opacity"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40">
            <ChevronLeft className="h-5 w-5" />
          </span>
        </button>

        <button
          type="button"
          onClick={goNext}
          aria-label="Next story"
          className="absolute inset-y-20 end-0 z-10 w-1/3 flex items-center justify-end pe-2 opacity-0 hover:opacity-100 transition-opacity"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40">
            <ChevronRight className="h-5 w-5" />
          </span>
        </button>

        {/* Bottom Caption & View Count */}
        <div className="relative z-20 px-4 pb-6 pt-8 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
          {currentStory.mediaType !== 'text' && currentStory.textContent && (
            <p className="mb-3 text-center text-sm font-medium text-white drop-shadow">
              {currentStory.textContent}
            </p>
          )}
          {currentSeq.isSelf && (
            <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-white/90">
              <Eye className="h-4 w-4" />
              <span>{currentStory.viewCount || 0} জন দেখেছেন</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
