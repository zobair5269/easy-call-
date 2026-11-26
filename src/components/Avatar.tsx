import React, { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { resolveApiUrl } from '../lib/api';

interface AvatarProps {
  src: string | null | undefined;
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  online?: boolean;
  verifiedCheck?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  xs: 'h-9 w-9 text-xs',
  sm: 'h-10 w-10 text-sm',
  md: 'h-[50px] w-[50px] text-base',
  lg: 'h-16 w-16 text-xl',
  xl: 'h-20 w-20 text-2xl',
};

const PALETTES = [
  'bg-sky-600 text-white',
  'bg-teal-600 text-white',
  'bg-emerald-600 text-white',
  'bg-indigo-600 text-white',
  'bg-slate-700 text-white',
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

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 'md',
  online,
  verifiedCheck,
}) => {
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
          className="h-full w-full rounded-full object-cover border border-slate-200/80 dark:border-slate-700"
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
      {verifiedCheck && online !== false ? (
        <span
          title={online ? 'Online' : 'Connected'}
          className="absolute -bottom-0.5 -end-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white dark:border-slate-900 bg-[#22C55E] text-white"
        >
          <Check className="h-2.5 w-2.5 stroke-[3]" />
        </span>
      ) : (
        online !== undefined && (
          <span
            title={online ? 'Online' : 'Offline'}
            className={`absolute bottom-0 end-0 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-slate-900 ${
              online ? 'bg-[#22C55E]' : 'bg-slate-400 dark:bg-slate-600'
            }`}
          />
        )
      )}
    </div>
  );
};

