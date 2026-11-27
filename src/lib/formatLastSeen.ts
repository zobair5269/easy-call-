import type { PublicUser } from '../types/app';

export function formatLastSeen(
  peer: Pick<PublicUser, 'online' | 'lastSeenAt' | 'showOnlineStatus' | 'countryIso'>,
  language: string
): string {
  if (peer.showOnlineStatus === false) {
    return peer.countryIso || '';
  }
  const isBn = language === 'bn';
  if (peer.online) {
    return isBn ? 'অনলাইন' : 'Online';
  }
  const ts = peer.lastSeenAt;
  if (!ts || ts <= 0) {
    return isBn ? 'অফলাইন' : 'Offline';
  }

  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - ts;
    if (diffMs >= 0 && diffMs < 60_000) {
      return isBn ? 'এইমাত্র অনলাইনে ছিলেন' : 'Last seen just now';
    }
    const timeStr = d
      .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      .toLowerCase();

    if (d.toDateString() === now.toDateString()) {
      return isBn ? `সর্বশেষ দেখা আজ ${timeStr}` : `Last seen today at ${timeStr}`;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return isBn ? `সর্বশেষ দেখা গতকাল ${timeStr}` : `Last seen yesterday at ${timeStr}`;
    }

    const dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return isBn
      ? `সর্বশেষ দেখা ${dateStr}, ${timeStr}`
      : `Last seen ${dateStr} at ${timeStr}`;
  } catch {
    return isBn ? 'অফলাইন' : 'Offline';
  }
}
