interface EasyCallNativeApi {
  setSessionAuth?: (serverUrl: string, token: string, userId: string) => void;
  getSessionAuth?: () => string;
  clearSessionAuth?: () => void;
  saveHistorySnapshot?: (phoneKey: string, json: string) => void;
  getHistorySnapshot?: (phoneKey: string) => string;
  clearHistorySnapshot?: (phoneKey: string) => void;
  stopRinging?: () => void;
  setCallAudioMode?: (inCall: boolean, speakerOn: boolean) => void;
  setSpeakerphone?: (speakerOn: boolean) => void;
  setRingtone?: (ringtoneId: string) => void;
  consumePendingAcceptCallId?: () => string;
  getDeviceContactsJson?: () => string;
}

declare global {
  interface Window {
    EasyCallNative?: EasyCallNativeApi;
  }
}

export function hasNativeAndroidBridge(): boolean {
  return typeof window !== 'undefined' && Boolean(window.EasyCallNative);
}

export function syncNativeSessionAuth(serverUrl: string, token: string, userId: string): void {
  try {
    window.EasyCallNative?.setSessionAuth?.(serverUrl, token, userId);
  } catch {
    // Ignore when running outside APK
  }
}

export function getNativeSessionAuth(): string {
  try {
    return window.EasyCallNative?.getSessionAuth?.()?.trim() || '';
  } catch {
    return '';
  }
}

export function clearNativeSessionAuth(): void {
  try {
    window.EasyCallNative?.clearSessionAuth?.();
  } catch {
    // Ignore when running outside APK
  }
}

export function saveNativeHistorySnapshot(phoneKey: string, json: string): void {
  try {
    window.EasyCallNative?.saveHistorySnapshot?.(phoneKey, json);
  } catch {
    // Ignore when running outside APK
  }
}

export function getNativeHistorySnapshot(phoneKey: string): string {
  try {
    return window.EasyCallNative?.getHistorySnapshot?.(phoneKey) || '';
  } catch {
    return '';
  }
}

export function clearNativeHistorySnapshot(phoneKey: string): void {
  try {
    window.EasyCallNative?.clearHistorySnapshot?.(phoneKey);
  } catch {
    // Ignore when running outside APK
  }
}

export function stopNativeRinging(): void {
  try {
    window.EasyCallNative?.stopRinging?.();
  } catch {
    // Ignore when running outside APK
  }
}

export function setNativeCallAudioMode(inCall: boolean, speakerOn: boolean): void {
  try {
    window.EasyCallNative?.setCallAudioMode?.(inCall, speakerOn);
  } catch {
    // Ignore when running outside APK
  }
}

export function setNativeSpeakerphone(speakerOn: boolean): void {
  try {
    window.EasyCallNative?.setSpeakerphone?.(speakerOn);
  } catch {
    // Ignore when running outside APK
  }
}

export function setNativeRingtone(ringtoneId: string): void {
  try {
    window.EasyCallNative?.setRingtone?.(ringtoneId);
  } catch {
    // Ignore when running outside APK
  }
}

export function consumeNativePendingAcceptCallId(): string {
  try {
    return window.EasyCallNative?.consumePendingAcceptCallId?.() || '';
  } catch {
    return '';
  }
}

export function getNativeDeviceContacts(): string[] {
  try {
    const raw = window.EasyCallNative?.getDeviceContactsJson?.();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
