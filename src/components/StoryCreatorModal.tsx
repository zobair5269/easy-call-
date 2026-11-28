import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Film,
  Image as ImageIcon,
  Loader2,
  Type,
  Users,
  X,
} from 'lucide-react';
import {
  apiFetch,
  fileToCompressedDataUrl,
  getAuthToken,
  initApiConfig,
  resolveApiUrl,
} from '../lib/api';
import type { StoryMediaType, StoryVisibility } from '../types/app';

interface StoryCreatorModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}

const BG_SWATCHES = [
  '#1D8BF1',
  '#0F766E',
  '#4F46E5',
  '#DB2777',
  '#EA580C',
  '#059669',
  '#1E293B',
  '#7C3AED',
];

export const StoryCreatorModal: React.FC<StoryCreatorModalProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const [mode, setMode] = useState<StoryMediaType>('text');
  const [visibility, setVisibility] = useState<StoryVisibility>('friends');
  const [textContent, setTextContent] = useState('');
  const [bgStyle, setBgStyle] = useState(BG_SWATCHES[0]);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoDurationSec, setVideoDurationSec] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setError(null);
      setSubmitting(false);
      setTextContent('');
      setImagePreviewUrl(null);
      setVideoFile(null);
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
      setVideoPreviewUrl(null);
      setVideoDurationSec(0);
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
    };
  }, [videoPreviewUrl]);

  if (!open) return null;

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    try {
      const dataUrl = await fileToCompressedDataUrl(file, 1080);
      setImagePreviewUrl(dataUrl);
      setMode('image');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load selected photo.');
    }
  };

  const handleVideoPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);

    if (file.size > 25 * 1024 * 1024) {
      setError('ভিডিও ফাইলটি ২৫ মেগাবাইটের কম হতে হবে (সর্বোচ্চ ৩০ সেকেন্ড)।');
      return;
    }

    const objUrl = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const dur = Number.isFinite(probe.duration) ? probe.duration : 0;
      if (dur > 30.9) {
        URL.revokeObjectURL(objUrl);
        setVideoFile(null);
        setVideoPreviewUrl(null);
        setVideoDurationSec(0);
        setError(`ভিডিওটি ${Math.round(dur)} সেকেন্ড। স্টোরি ভিডিও সর্বোচ্চ ৩০ সেকেন্ডের হতে হবে।`);
        return;
      }
      if (videoPreviewUrl) {
        URL.revokeObjectURL(videoPreviewUrl);
      }
      setVideoFile(file);
      setVideoPreviewUrl(objUrl);
      setVideoDurationSec(Math.max(1, Math.min(30, Math.round(dur || 15))));
      setMode('video');
    };
    probe.onerror = () => {
      URL.revokeObjectURL(objUrl);
      setError('এই ভিডিও ফরম্যাটটি সাপোর্ট করছে না। MP4 বা WebM ভিডিও দিন।');
    };
    probe.src = objUrl;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === 'text' && !textContent.trim()) {
      setError('স্টোরিতে কিছু লিখুন।');
      return;
    }
    if (mode === 'image' && !imagePreviewUrl) {
      setError('একটি ছবি সিলেক্ট করুন।');
      return;
    }
    if (mode === 'video' && !videoFile) {
      setError('সর্বোচ্চ ৩০ সেকেন্ডের একটি ভিডিও সিলেক্ট করুন।');
      return;
    }
    if (mode === 'video' && videoDurationSec > 30.9) {
      setError('স্টোরি ভিডিও সর্বোচ্চ ৩০ সেকেন্ড হতে পারবে।');
      return;
    }

    setSubmitting(true);
    try {
      let uploadId: string | null = null;

      if (mode === 'image' && imagePreviewUrl) {
        const up = await apiFetch<{ uploadId: string; url: string }>('/api/uploads/image', {
          method: 'POST',
          body: JSON.stringify({
            dataUrl: imagePreviewUrl,
            purpose: 'story',
          }),
        });
        uploadId = up.uploadId;
      } else if (mode === 'video' && videoFile) {
        await initApiConfig();
        const headers = new Headers();
        const allowedMime =
          videoFile.type === 'video/mp4' ||
          videoFile.type === 'video/webm' ||
          videoFile.type === 'video/quicktime'
            ? videoFile.type
            : 'application/octet-stream';
        headers.set('Content-Type', allowedMime);
        headers.set('X-Requested-With', 'EasyCallClient');
        const tok = getAuthToken();
        if (tok) {
          headers.set('Authorization', `Bearer ${tok}`);
        }
        const upRes = await fetch(resolveApiUrl('/api/uploads/story-video'), {
          method: 'POST',
          headers,
          body: videoFile,
          credentials: 'include',
        });
        const upData = await upRes.json().catch(() => ({}));
        if (!upRes.ok || !upData?.uploadId) {
          throw new Error(
            typeof upData?.error === 'string'
              ? upData.error
              : 'ভিডিও আপলোড করা যায়নি।'
          );
        }
        uploadId = String(upData.uploadId);
      }

      await apiFetch('/api/stories', {
        method: 'POST',
        body: JSON.stringify({
          mediaType: mode,
          textContent: textContent.trim(),
          bgStyle,
          uploadId,
          durationSec: mode === 'video' ? videoDurationSec : 5,
          visibility,
        }),
      });

      await onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'স্টোরি পোস্ট করা যায়নি।');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-[#1D8BF1]" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              নতুন স্টোরি দিন (Story)
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode Selector: Text / Photo / 30s Video */}
        <div className="grid grid-cols-3 gap-2 px-4 pt-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode('text');
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold border transition-colors ${
              mode === 'text'
                ? 'border-[#1D8BF1] bg-[#1D8BF1]/10 text-[#1D8BF1]'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Type className="h-4 w-4" />
            <span>লিখুন</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode('image');
              if (!imagePreviewUrl) imageInputRef.current?.click();
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold border transition-colors ${
              mode === 'image'
                ? 'border-[#1D8BF1] bg-[#1D8BF1]/10 text-[#1D8BF1]'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            <ImageIcon className="h-4 w-4" />
            <span>পিকচার</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setMode('video');
              if (!videoPreviewUrl) videoInputRef.current?.click();
            }}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold border transition-colors ${
              mode === 'video'
                ? 'border-[#1D8BF1] bg-[#1D8BF1]/10 text-[#1D8BF1]'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
            }`}
          >
            <Film className="h-4 w-4" />
            <span>৩০সেঃ ভিডিও</span>
          </button>
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImagePick}
          className="hidden"
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,video/*"
          onChange={handleVideoPick}
          className="hidden"
        />

        <form onSubmit={handleSubmit} className="p-4 space-y-4 overflow-y-auto">
          {mode === 'text' && (
            <div className="space-y-3">
              <div
                style={{ backgroundColor: bgStyle }}
                className="rounded-2xl p-4 min-h-[190px] flex items-center justify-center shadow-inner transition-colors"
              >
                <textarea
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value.slice(0, 500))}
                  placeholder="আপনার মনের কথা লিখুন..."
                  rows={4}
                  className="w-full resize-none bg-transparent text-center text-lg font-semibold text-white placeholder:text-white/70 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {BG_SWATCHES.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setBgStyle(swatch)}
                      aria-label={`Select background ${swatch}`}
                      style={{ backgroundColor: swatch }}
                      className={`h-7 w-7 rounded-full border-2 flex items-center justify-center ${
                        bgStyle === swatch
                          ? 'border-slate-900 dark:border-white scale-110'
                          : 'border-transparent'
                      }`}
                    >
                      {bgStyle === swatch && <Check className="h-3.5 w-3.5 text-white" />}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-slate-400 tabular-nums">
                  {textContent.length}/500
                </span>
              </div>
            </div>
          )}

          {mode === 'image' && (
            <div className="space-y-3">
              {imagePreviewUrl ? (
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 max-h-[260px] flex items-center justify-center">
                  <img
                    src={imagePreviewUrl}
                    alt="Story preview"
                    className="max-h-[260px] w-full object-contain"
                  />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="absolute bottom-2.5 end-2.5 rounded-xl bg-black/65 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black/80"
                  >
                    ছবি পরিবর্তন করুন
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  className="w-full min-h-[160px] rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400 hover:border-[#1D8BF1]"
                >
                  <ImageIcon className="h-8 w-8 text-[#1D8BF1]" />
                  <span className="text-xs font-semibold">গ্যালারি বা ক্যামেরা থেকে ছবি নিন</span>
                </button>
              )}
              <input
                type="text"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value.slice(0, 200))}
                placeholder="ছবির সাথে কিছু লিখুন (ঐচ্ছিক)"
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
              />
            </div>
          )}

          {mode === 'video' && (
            <div className="space-y-3">
              {videoPreviewUrl ? (
                <div className="relative rounded-2xl overflow-hidden bg-slate-950 max-h-[260px]">
                  <video
                    src={videoPreviewUrl}
                    controls
                    playsInline
                    className="max-h-[260px] w-full object-contain"
                  />
                  <div className="flex items-center justify-between px-3 py-2 bg-slate-900 text-xs text-slate-200">
                    <span>সময়: {videoDurationSec} সেকেন্ড (সর্বোচ্চ ৩০ সেকেন্ড)</span>
                    <button
                      type="button"
                      onClick={() => videoInputRef.current?.click()}
                      className="text-[#1D8BF1] font-semibold"
                    >
                      ভিডিও পরিবর্তন
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => videoInputRef.current?.click()}
                  className="w-full min-h-[160px] rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400 hover:border-[#1D8BF1]"
                >
                  <Film className="h-8 w-8 text-[#1D8BF1]" />
                  <span className="text-xs font-semibold">সর্বোচ্চ ৩০ সেকেন্ডের ভিডিও সিলেক্ট করুন</span>
                </button>
              )}
              <input
                type="text"
                value={textContent}
                onChange={(e) => setTextContent(e.target.value.slice(0, 200))}
                placeholder="ভিডিওর সাথে কিছু লিখুন (ঐচ্ছিক)"
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-sm text-slate-900 dark:text-white focus:border-[#1D8BF1] focus:outline-none"
              />
            </div>
          )}

          {/* Visibility Options: ফ্রেন্ড & ফ্রেন্ডস অফ ফ্রেন্ড */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
              <Users className="h-3.5 w-3.5 text-[#1D8BF1]" />
              <span>কে কে এই স্টোরি দেখতে পারবে?</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setVisibility('friends')}
                className={`flex flex-col items-start rounded-xl border p-2.5 text-start transition-colors ${
                  visibility === 'friends'
                    ? 'border-[#1D8BF1] bg-[#1D8BF1]/10 text-slate-900 dark:text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-xs font-bold">ফ্রেন্ড</span>
                  {visibility === 'friends' && <Check className="h-3.5 w-3.5 text-[#1D8BF1]" />}
                </div>
                <span className="mt-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
                  শুধু আপনার ফ্রেন্ডরা দেখবে
                </span>
              </button>

              <button
                type="button"
                onClick={() => setVisibility('friends_of_friends')}
                className={`flex flex-col items-start rounded-xl border p-2.5 text-start transition-colors ${
                  visibility === 'friends_of_friends'
                    ? 'border-[#1D8BF1] bg-[#1D8BF1]/10 text-slate-900 dark:text-white'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                <div className="flex w-full items-center justify-between">
                  <span className="text-xs font-bold">ফ্রেন্ডস অফ ফ্রেন্ড</span>
                  {visibility === 'friends_of_friends' && (
                    <Check className="h-3.5 w-3.5 text-[#1D8BF1]" />
                  )}
                </div>
                <span className="mt-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
                  ফ্রেন্ড ও তাদের ফ্রেন্ডরাও দেখবে
                </span>
              </button>
            </div>
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs font-medium text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[46px] rounded-xl bg-[#1D8BF1] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#1979D2] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>পোস্ট হচ্ছে...</span>
              </>
            ) : (
              <span>স্টোরি শেয়ার করুন</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
