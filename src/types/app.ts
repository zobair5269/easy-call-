export interface SelfUser {
  id: string;
  phoneE164: string;
  countryIso: string;
  countryCode: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  language: string;
  qrToken: string;
  discoverableByPhone: boolean;
  discoverableByName: boolean;
  showOnlineStatus: boolean;
  dataSaver: boolean;
  hasRecoveryPin: boolean;
  createdAt: number;
}

export interface PublicUser {
  id: string;
  phoneE164?: string;
  countryIso: string;
  countryCode: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  qrToken: string;
  lastSeenAt: number;
  online?: boolean;
  showOnlineStatus?: boolean;
  isFriend?: boolean;
  requestStatus?: 'accepted' | 'outgoing_pending' | 'incoming_pending' | 'none';
}

export interface FriendRequestItem {
  requestId: string;
  createdAt: number;
  user: PublicUser;
}

export interface CallRecordItem {
  id: string;
  peerId: string;
  peerName: string;
  peerAvatarUrl: string | null;
  peerCountryIso: string;
  direction: 'incoming' | 'outgoing';
  callType: 'audio' | 'video';
  status: 'ringing' | 'active' | 'completed' | 'missed' | 'rejected' | 'cancelled';
  startedAt: number;
  endedAt: number | null;
  durationSec: number;
  canCallback: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  receiverId: string;
  body: string;
  imageUrl: string | null;
  status: 'sent' | 'delivered' | 'read';
  createdAt: number;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  relatedUserId: string | null;
  isRead: boolean;
  createdAt: number;
}

export type ActiveTab = 'home' | 'calls' | 'contacts' | 'settings';
