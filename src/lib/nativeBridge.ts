interface EasyCallNativeApi {
  setSessionAuth?: (serverUrl: string, token: string, userId: string) => void;
  clearSessionAuth?: () => void;
  stopRinging?: () => void;
  setCallAudioMode?: (inCall: boolean, speakerOn: boolean) => void;
  setSpeakerphone?: (speakerOn: boolean) => void;
  setRingtone?: (ringtoneId: string) => void;
  consumePendingAcceptCallId?: () => string;
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

export function clearNativeSessionAuth(): void {
  try {
    window.EasyCallNative?.clearSessionAuth?.();
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
