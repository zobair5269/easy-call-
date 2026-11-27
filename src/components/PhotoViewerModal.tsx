import React, { useEffect } from 'react';
import { ArrowLeft, User, X } from 'lucide-react';
import { resolveApiUrl } from '../lib/api';

export interface PhotoViewerTarget {
  url: string | null | undefined;
  name: string;
  subtitle?: string;
}

interface PhotoViewerModalProps {
  photo: PhotoViewerTarget | null;
  onClose: () => void;
}

export const PhotoViewerModal: React.FC<PhotoViewerModalProps> = ({ photo, onClose }) => {
  useEffect(() => {
    if (!photo) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [photo, onClose]);

  if (!photo) return null;

  const resolvedUrl = photo.url
    ? photo.url.startsWith('/api/')
      ? resolveApiUrl(photo.url)
      : photo.url
    : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={photo.name}
      onClick={onClose}
      className="fixed inset-0 z-[70] flex flex-col bg-black/95 text-white"
    >
      {/* Top Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-3 px-4 py-3 pt-safe border-b border-white/10"
      >
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            className="flex min-h-[44px] min-w-[44px] -ms-2 items-center justify-center rounded-full text-white hover:bg-white/10 shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="text-base font-semibold text-white truncate">{photo.name}</p>
            {photo.subtitle && (
              <p className="text-xs text-slate-300 truncate">{photo.subtitle}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-white hover:bg-white/10 shrink-0"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Centered Enlarged Photo */}
      <div className="flex flex-1 items-center justify-center p-4">
        {resolvedUrl ? (
          <img
            src={resolvedUrl}
            alt={photo.name}
            referrerPolicy="no-referrer"
            onClick={(e) => e.stopPropagation()}
            className="max-h-[78vh] max-w-[94vw] rounded-2xl object-contain shadow-2xl border border-white/10"
          />
        ) : (
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex flex-col items-center justify-center gap-3 rounded-3xl bg-slate-900/90 border border-white/10 px-10 py-12 text-center"
          >
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-slate-800 text-slate-400">
              <User className="h-14 w-14" />
            </div>
            <p className="text-sm font-medium text-slate-300">No profile photo uploaded</p>
          </div>
        )}
      </div>
    </div>
  );
};
