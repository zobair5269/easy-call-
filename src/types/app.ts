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
  calleeSeen?: boolean;
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

export interface HomeFeedItem {
  peer: PublicUser;
  lastActivityAt: number;
  lastCall: {
    id: string;
    direction: 'incoming' | 'outgoing';
    callType: 'audio' | 'video';
    status: string;
    durationSec: number;
    startedAt: number;
  } | null;
  lastMessage: {
    id: string;
    senderId: string;
    body: string;
    hasImage: boolean;
    createdAt: number;
  } | null;
  unreadCount: number;
  missedCount?: number;
}

export type StoryVisibility = 'friends' | 'friends_of_friends';
export type StoryMediaType = 'text' | 'image' | 'video';

export interface StoryItem {
  id: string;
  authorId: string;
  mediaType: StoryMediaType;
  textContent: string;
  bgStyle: string;
  mediaUrl: string | null;
  durationSec: number;
  visibility: StoryVisibility;
  createdAt: number;
  expiresAt: number;
  viewedByMe: boolean;
  viewCount?: number;
}

export interface StoryAuthorGroup {
  author: PublicUser;
  relation: 'friend' | 'friend_of_friend';
  hasUnviewed: boolean;
  latestCreatedAt: number;
  stories: StoryItem[];
}

export type ActiveTab = 'home' | 'calls' | 'contacts' | 'settings';

