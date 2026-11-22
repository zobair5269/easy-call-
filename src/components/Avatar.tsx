import React, { useEffect, useState } from 'react';
import { resolveApiUrl } from '../lib/api';

interface AvatarProps {
  src: string | null | undefined;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-10 w-10 text-sm',
  md: 'h-12 w-12 text-base',
  lg: 'h-16 w-16 text-xl',
  xl: 'h-24 w-24 text-2xl',
};

const PALETTES = [
  'bg-teal-700 text-white',
  'bg-sky-700 text-white',
  'bg-emerald-700 text-white',
  'bg-slate-700 text-white',
  'bg-cyan-800 text-white',
];

function getInitials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'EC';
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getPaletteClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return PALETTES[Math.abs(hash) % PALETTES.length];
}

export const Avatar: React.FC<AvatarProps> = ({ src, name, size = 'md', online }) => {
  const [failed, setFailed] = useState(false);
  const sizeClass = SIZE_CLASSES[size];
  const resolvedSrc = src ? (src.startsWith('/api/') ? resolveApiUrl(src) : src) : null;

  useEffect(() => {
    setFailed(false);
  }, [resolvedSrc]);

  return (
    <div className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${sizeClass}`}>
      {resolvedSrc && !failed ? (
        <img
          src={resolvedSrc}
          alt={name || 'Profile photo'}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="h-full w-full rounded-full object-cover border border-slate-200 dark:border-slate-700"
        />
      ) : (
        <div
          aria-label={name}
          className={`flex h-full w-full items-center justify-center rounded-full font-semibold tracking-tight ${getPaletteClass(
            name || 'EC'
          )}`}
        >
          {getInitials(name)}
        </div>
      )}
      {online !== undefined && (
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute bottom-0 end-0 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-slate-900 ${
            online ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-600'
          }`}
        />
      )}
    </div>
  );
};
