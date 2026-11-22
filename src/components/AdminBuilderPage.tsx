import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Hammer,
  KeyRound,
  Lock,
  LogOut,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { getAuthToken, getConfiguredServerUrl, isNativeApkOrigin, resolveApiUrl } from '../lib/api';

interface AdminStatus {
  authenticated: boolean;
  envConfigured: boolean;
  setupRequired: boolean;
  requiresAdminNumber: boolean;
  isAdminUser: boolean;
}

interface BuilderInfo {
  nativeApkCompilerAvailable: boolean;
  config: {
    appName: string;
    applicationId: string;
    versionName: string;
    versionCode: number;
    serverUrl: string;
    builtAt?: number;
  };
  artifacts: {
    apkReady: boolean;
    apkSizeBytes: number;
  };
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AdminBuilderPage: React.FC<{ onBackToApp: () => void }> = ({ onBackToApp }) => {
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [adminNumber, setAdminNumber] = useState('');
  const [passcode, setPasscode] = useState('');
  const [confirmPasscode, setConfirmPasscode] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [builderInfo, setBuilderInfo] = useState<BuilderInfo | null>(null);
  const [appName, setAppName] = useState('EASY CALL');
  const [applicationId, setApplicationId] = useState('app.easycall.global');
  const [versionName, setVersionName] = useState('1.0.0');
  const [versionCode, setVersionCode] = useState('1');
  const [serverUrl, setServerUrl] = useState(() =>
    typeof window !== 'undefined'
      ? isNativeApkOrigin()
        ? getConfiguredServerUrl()
        : window.location.origin
      : ''
  );

  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildSuccess, setBuildSuccess] = useState<string | null>(null);
  const [urlCheck, setUrlCheck] = useState<{ checking: boolean; reachable?: boolean; status?: number }>({
    checking: false,
  });

  const adminFetch = useCallback(
    async <T,>(path: string, options: RequestInit = {}): Promise<T> => {
      const headers = new Headers(options.headers || {});
      if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
        headers.set('Content-Type', 'application/json');
      }
      headers.set('X-Requested-With', 'EasyCallClient');
      const userToken = getAuthToken();
      if (userToken) {
        headers.set('X-User-Token', userToken);
      }
      if (adminToken) {
        headers.set('Authorization', `Bearer ${adminToken}`);
      }
      const res = await fetch(resolveApiUrl(path), { ...options, headers, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : `Error (${res.status})`);
      }
      return data as T;
    },
    [adminToken]
  );

  const loadBuilderInfo = useCallback(async () => {
    try {
      const info = await adminFetch<BuilderInfo>('/api/admin/android-builder/info');
      setBuilderInfo(info);
      setAppName(info.config.appName || 'EASY CALL');
      setApplicationId(info.config.applicationId || 'app.easycall.global');
      setVersionName(info.config.versionName || '1.0.0');
      setVersionCode(String(info.config.versionCode || 1));
      const target = info.config.serverUrl || window.location.origin;
      setServerUrl(target);
      if (target) {
        setUrlCheck({ checking: true });
        adminFetch<{ reachable: boolean; status: number }>(
          `/api/admin/android-builder/check-url?url=${encodeURIComponent(target)}`
        )
          .then((chk) => setUrlCheck({ checking: false, reachable: chk.reachable, status: chk.status }))
          .catch(() => setUrlCheck({ checking: false, reachable: false, status: 0 }));
      }
    } catch {
      // Ignore until authenticated
    }
  }, [adminFetch]);

  const checkStatus = useCallback(async () => {
    try {
      const st = await adminFetch<AdminStatus>('/api/admin/status');
      setStatus(st);
      if (st.authenticated) {
        await loadBuilderInfo();
      }
    } catch {
      setStatus({
        authenticated: false,
        envConfigured: false,
        setupRequired: false,
        requiresAdminNumber: true,
        isAdminUser: false,
      });
    }
  }, [adminFetch, loadBuilderInfo]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    if (passcode.trim().length < 6) {
      setAuthError('Password must be at least 6 characters.');
      return;
    }
    if (passcode !== confirmPasscode) {
      setAuthError('Passwords do not match.');
      return;
    }
    setAuthBusy(true);
    try {
      const res = await adminFetch<{ ok: boolean; token: string }>('/api/admin/claim', {
        method: 'POST',
        body: JSON.stringify({
          adminNumber: adminNumber.trim(),
          passcode: passcode.trim(),
        }),
      });
      setAdminToken(res.token);
      setPasscode('');
      setConfirmPasscode('');
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              authenticated: true,
              setupRequired: false,
              requiresAdminNumber: Boolean(adminNumber.trim()),
            }
          : prev
      );
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to claim admin access.');
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthBusy(true);
    try {
      const res = await adminFetch<{ ok: boolean; token: string }>('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({
          adminNumber: adminNumber.trim(),
          passcode: passcode.trim(),
        }),
      });
      setAdminToken(res.token);
      setPasscode('');
      setStatus((prev) => (prev ? { ...prev, authenticated: true } : prev));
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Invalid admin credentials.');
    } finally {
      setAuthBusy(false);
    }
  };

  useEffect(() => {
    if (status?.authenticated) {
      loadBuilderInfo();
    }
  }, [status?.authenticated, loadBuilderInfo]);

  const triggerApkDownload = useCallback(async () => {
    const headers = new Headers({ 'X-Requested-With': 'EasyCallClient' });
    if (adminToken) headers.set('Authorization', `Bearer ${adminToken}`);
    const res = await fetch(resolveApiUrl('/api/admin/android-builder/download'), {
      headers,
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error || 'Download failed.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'EASY_CALL_ANDROID.apk';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [adminToken]);

  const buildApk = async (autoDownload: boolean) => {
    setBuildError(null);
    setBuildSuccess(null);
    setBuilding(true);
    try {
      const res = await adminFetch<{
        ok: boolean;
        compiledApk: boolean;
        apkSizeBytes: number;
      }>('/api/admin/android-builder/build', {
        method: 'POST',
        body: JSON.stringify({
          appName,
          applicationId,
          versionName,
          versionCode: Number(versionCode),
          serverUrl,
        }),
      });
      await loadBuilderInfo();
      setBuildSuccess(
        `Signed EASY_CALL_ANDROID.apk built (${formatBytes(res.apkSizeBytes)}). Ready to install on Android.`
      );
      if (autoDownload) {
        await triggerApkDownload();
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'APK build failed.');
    } finally {
      setBuilding(false);
    }
  };

  const handleRebuild = async (e: React.FormEvent) => {
    e.preventDefault();
    await buildApk(false);
  };

  const handleDirectDownload = async () => {
    setBuildError(null);
    try {
      if (builderInfo?.artifacts.apkReady) {
        await triggerApkDownload();
      } else {
        await buildApk(true);
      }
    } catch (err) {
      setBuildError(err instanceof Error ? err.message : 'Download failed.');
    }
  };

  const handleLogout = async () => {
    await adminFetch('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setAdminToken(null);
    setBuilderInfo(null);
    setStatus((prev) => (prev ? { ...prev, authenticated: false } : prev));
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <img
              src="/easycall-logo.png"
              alt="EASY CALL"
              className="h-9 w-9 rounded-full object-cover"
            />
            <span className="font-display text-base sm:text-lg font-bold">
              EASY CALL Admin · Android APK Builder
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBackToApp}
              className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 dark:border-slate-700 px-3.5 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ArrowLeft className="h-4 w-4" />
              App
            </button>
            {status?.authenticated && (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-slate-700 px-3.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <LogOut className="h-4 w-4" />
                Sign Out
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        {!status ? (
          <div className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-sm text-slate-500">
            Checking admin authorization...
          </div>
        ) : !status.authenticated ? (
          <div className="mx-auto max-w-md rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-700 text-white">
                <Lock className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold">
                  {status.setupRequired ? 'Claim Admin Access' : 'Admin Sign-In Required'}
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Private Android APK Builder & Direct APK Download (Admin Only)
                </p>
              </div>
            </div>

            {status.setupRequired ? (
              <form onSubmit={handleClaim} className="space-y-4">
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  Set your private Admin Number & Password (or configure <code className="font-mono">ADMIN_NUMBER</code> and <code className="font-mono">ADMIN_PASSCODE</code> in Secrets).
                </p>
                <div>
                  <label className="block text-sm font-medium mb-1">Admin Number</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    required
                    value={adminNumber}
                    onChange={(e) => setAdminNumber(e.target.value)}
                    placeholder="Enter admin number"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">New Admin Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Confirm Password</label>
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmPasscode}
                    onChange={(e) => setConfirmPasscode(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                {authError && (
                  <p className="rounded-xl bg-rose-50 dark:bg-rose-950/50 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={authBusy}
                  className="w-full min-h-[48px] rounded-xl bg-teal-700 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  {authBusy ? 'Saving...' : 'Claim & Open APK Builder'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-4">
                {status.requiresAdminNumber && (
                  <div>
                    <label className="block text-sm font-medium mb-1">Admin Number</label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      required
                      value={adminNumber}
                      onChange={(e) => setAdminNumber(e.target.value)}
                      placeholder="Enter admin number"
                      className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm focus:border-teal-600 focus:outline-none"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium mb-1">Admin Password</label>
                  <input
                    type="password"
                    required
                    value={passcode}
                    onChange={(e) => setPasscode(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full min-h-[48px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm focus:border-teal-600 focus:outline-none"
                  />
                </div>
                {authError && (
                  <p className="rounded-xl bg-rose-50 dark:bg-rose-950/50 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-300">
                    {authError}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={authBusy}
                  className="flex w-full min-h-[48px] items-center justify-center gap-2 rounded-xl bg-teal-700 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
                >
                  <KeyRound className="h-4 w-4" />
                  {authBusy ? 'Verifying...' : 'Unlock & Download APK'}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {/* Direct 1-Click APK Download Card */}
            <section className="rounded-3xl border border-teal-200 dark:border-teal-900 bg-white dark:bg-slate-900 p-6 space-y-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-6 w-6 text-teal-700 dark:text-teal-400 shrink-0" />
                  <div>
                    <h1 className="font-display text-xl font-bold">
                      Direct Android APK Download
                    </h1>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                      Signed installable Android <code className="font-mono">.apk</code> file ready for direct installation on Android phones. Visible only to Admin.
                    </p>
                  </div>
                </div>
                <ShieldCheck className="h-6 w-6 text-emerald-600 shrink-0" />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <button
                  type="button"
                  disabled={building}
                  onClick={handleDirectDownload}
                  className="inline-flex min-h-[52px] items-center gap-2.5 rounded-2xl bg-emerald-700 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-800 shadow-sm disabled:opacity-60"
                >
                  <Download className="h-5 w-5" />
                  {building
                    ? 'Building EASY_CALL_ANDROID.apk...'
                    : builderInfo?.artifacts.apkReady
                      ? `Download EASY_CALL_ANDROID.apk (${formatBytes(builderInfo.artifacts.apkSizeBytes)})`
                      : 'Build & Download EASY_CALL_ANDROID.apk'}
                </button>
              </div>
            </section>

            {/* Build / Customize APK Form */}
            <form
              onSubmit={handleRebuild}
              className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5"
            >
              <h2 className="font-display text-lg font-bold flex items-center gap-2">
                <Hammer className="h-5 w-5 text-teal-700 dark:text-teal-400" />
                Android APK Settings & Rebuild
              </h2>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1">App Name</label>
                  <input
                    type="text"
                    required
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Android Package ID</label>
                  <input
                    type="text"
                    required
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Version Name</label>
                  <input
                    type="text"
                    required
                    value={versionName}
                    onChange={(e) => setVersionName(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Version Code</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={versionCode}
                    onChange={(e) => setVersionCode(e.target.value)}
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium mb-1">Live Server URL</label>
                  <input
                    type="url"
                    required
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://your-easycall-domain.com"
                    className="w-full min-h-[46px] rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 font-mono text-sm"
                  />
                  {!urlCheck.checking && urlCheck.reachable === false && (
                    <p className="mt-2 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 px-3.5 py-2 text-xs text-amber-900 dark:text-amber-200">
                      Server check returned HTTP {urlCheck.status || 'unreachable'}. Ensure your public server URL above is running (HTTP 200) and then click <strong>Rebuild EASY_CALL_ANDROID.apk</strong>.
                    </p>
                  )}
                  {!urlCheck.checking && urlCheck.reachable === true && (
                    <p className="mt-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                      Live Server URL verified (HTTP 200 · Ready for mobile APK users).
                    </p>
                  )}
                </div>
              </div>

              {buildError && (
                <p className="rounded-xl bg-rose-50 dark:bg-rose-950/50 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                  {buildError}
                </p>
              )}

              {buildSuccess && (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm font-medium text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span>{buildSuccess}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={building}
                className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                <Hammer className="h-4 w-4" />
                {building ? 'Compiling APK...' : 'Rebuild EASY_CALL_ANDROID.apk'}
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
};
