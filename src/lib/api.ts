const APK_TOKEN_STORAGE_KEY = 'easycall_apk_token';
let inMemoryToken: string | null = null;
let apkConfigServerUrl = '';
let apkConfigLoaded = false;

export function isNativeApkOrigin(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === 'easycall.app';
}

export function getConfiguredServerUrl(): string {
  if (!isNativeApkOrigin()) return '';
  try {
    const custom = window.localStorage.getItem('easycall_server_url');
    if (custom && /^https?:\/\//i.test(custom.trim())) {
      return custom.trim().replace(/\/+$/, '');
    }
  } catch {
    // Ignore storage access errors
  }
  return apkConfigServerUrl.replace(/\/+$/, '');
}

export function setConfiguredServerUrl(url: string): void {
  const cleaned = url.trim().replace(/\/+$/, '');
  try {
    if (cleaned) {
      window.localStorage.setItem('easycall_server_url', cleaned);
    } else {
      window.localStorage.removeItem('easycall_server_url');
    }
  } catch {
    // Ignore storage access errors
  }
}

export async function initApiConfig(): Promise<void> {
  if (!isNativeApkOrigin()) return;
  if (!inMemoryToken) {
    try {
      const saved = window.localStorage.getItem(APK_TOKEN_STORAGE_KEY);
      if (saved) inMemoryToken = saved;
    } catch {
      // Ignore storage access errors
    }
  }
  if (apkConfigLoaded) return;
  apkConfigLoaded = true;
  try {
    const res = await fetch('/easycall-config.json');
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.serverUrl === 'string') {
        apkConfigServerUrl = data.serverUrl.trim().replace(/\/+$/, '');
      }
    }
  } catch {
    // Ignore missing config
  }
}

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
  if (isNativeApkOrigin()) {
    try {
      if (token) {
        window.localStorage.setItem(APK_TOKEN_STORAGE_KEY, token);
      } else {
        window.localStorage.removeItem(APK_TOKEN_STORAGE_KEY);
      }
    } catch {
      // Ignore storage access errors
    }
  }
}

export function getAuthToken(): string | null {
  return inMemoryToken;
}

export function resolveApiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = getConfiguredServerUrl();
  return base ? `${base}${path}` : path;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  if (isNativeApkOrigin() && !apkConfigLoaded) {
    await initApiConfig();
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }
  headers.set('X-Requested-With', 'EasyCallClient');
  if (inMemoryToken) {
    headers.set('Authorization', `Bearer ${inMemoryToken}`);
  }

  const targetUrl = resolveApiUrl(path);
  let res: Response | null = null;
  let lastNetworkError = false;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await fetch(targetUrl, {
        ...options,
        headers,
        credentials: 'include',
      });
      if (attempt === 0 && (res.status === 502 || res.status === 503 || res.status === 504)) {
        await new Promise((r) => setTimeout(r, 2500));
        continue;
      }
      lastNetworkError = false;
      break;
    } catch {
      lastNetworkError = true;
      if (attempt === 0 && isNativeApkOrigin() && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      break;
    }
  }

  if (lastNetworkError || !res) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new Error('No internet connection on this device.');
    }
    if (isNativeApkOrigin()) {
      throw new Error('Server is waking up or unreachable. Wait 15 seconds and tap again.');
    }
    throw new Error('Unable to reach EASY CALL server. Please try again.');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      setAuthToken(null);
    }
    const message =
      typeof data?.error === 'string'
        ? data.error
        : res.status === 404 && isNativeApkOrigin()
          ? 'Server endpoint not found (404). Please verify Server URL.'
          : res.status >= 502 && res.status <= 504
            ? 'Server is starting up. Please wait a few seconds and try again.'
            : `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data as T;
}

export function buildWsUrl(): string {
  const configured = getConfiguredServerUrl();
  if (configured) {
    try {
      const u = new URL(configured);
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      const base = `${wsProto}//${u.host}/ws`;
      return inMemoryToken ? `${base}?token=${encodeURIComponent(inMemoryToken)}` : base;
    } catch {
      // Fallback below
    }
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${proto}//${window.location.host}/ws`;
  if (inMemoryToken) {
    return `${base}?token=${encodeURIComponent(inMemoryToken)}`;
  }
  return base;
}

export function fileToCompressedDataUrl(file: File, maxDim = 960): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported or corrupted image file.'));
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable.'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
