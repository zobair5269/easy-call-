import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface ApkBuildConfig {
  appName: string;
  applicationId: string;
  versionName: string;
  versionCode: number;
  serverUrl: string;
}

export interface ApkToolchain {
  available: boolean;
  hasJava: boolean;
  hasKeytool: boolean;
  sdkRoot: string | null;
  aapt2Path: string | null;
  d8Path: string | null;
  zipalignPath: string | null;
  apksignerPath: string | null;
  androidJarPath: string | null;
}

async function resolveBinary(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('which', [name]);
    const p = stdout.trim();
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function findSdkRoot(): string | null {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    '/opt/android-sdk',
    '/usr/local/android-sdk',
  ].filter((x): x is string => Boolean(x && x.trim()));

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

function findLatestSubdir(parent: string): string | null {
  if (!fs.existsSync(parent)) return null;
  const entries = fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return entries.length > 0 ? path.join(parent, entries[0]) : null;
}

export async function detectApkToolchain(): Promise<ApkToolchain> {
  const [javacPath, keytoolPath] = await Promise.all([
    resolveBinary('javac'),
    resolveBinary('keytool'),
  ]);
  const sdkRoot = findSdkRoot();

  let aapt2Path: string | null = null;
  let d8Path: string | null = null;
  let zipalignPath: string | null = null;
  let apksignerPath: string | null = null;
  let androidJarPath: string | null = null;

  if (sdkRoot) {
    const buildToolsDir = findLatestSubdir(path.join(sdkRoot, 'build-tools'));
    if (buildToolsDir) {
      const a2 = path.join(buildToolsDir, 'aapt2');
      const d8 = path.join(buildToolsDir, 'd8');
      const za = path.join(buildToolsDir, 'zipalign');
      const as = path.join(buildToolsDir, 'apksigner');
      if (fs.existsSync(a2)) aapt2Path = a2;
      if (fs.existsSync(d8)) d8Path = d8;
      if (fs.existsSync(za)) zipalignPath = za;
      if (fs.existsSync(as)) apksignerPath = as;
    }
    const platformDir = findLatestSubdir(path.join(sdkRoot, 'platforms'));
    if (platformDir) {
      const jar = path.join(platformDir, 'android.jar');
      if (fs.existsSync(jar)) androidJarPath = jar;
    }
  }

  const available = Boolean(
    javacPath &&
      keytoolPath &&
      aapt2Path &&
      d8Path &&
      zipalignPath &&
      apksignerPath &&
      androidJarPath
  );

  return {
    available,
    hasJava: Boolean(javacPath),
    hasKeytool: Boolean(keytoolPath),
    sdkRoot,
    aapt2Path,
    d8Path,
    zipalignPath,
    apksignerPath,
    androidJarPath,
  };
}

function sanitizeXmlText(val: string): string {
  return val
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeJavaString(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function collectClassFiles(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectClassFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.class')) {
      out.push(full);
    }
  }
  return out;
}

function copyDistForApk(srcDir: string, destDir: string) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const name = entry.name;
    // Exclude user upload screenshots or unused legacy hero assets or SW files
    if (
      name === 'aistudio' ||
      name.startsWith('welcome_connection_') ||
      name === 'sw.js' ||
      name === 'registerSW.js' ||
      name.startsWith('workbox-')
    ) {
      continue;
    }
    const srcPath = path.join(srcDir, name);
    const destPath = path.join(destDir, name);
    if (entry.isDirectory()) {
      copyDistForApk(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function ensureSigningKeystore(buildsDir: string): Promise<{ keystorePath: string; pass: string }> {
  const keystorePath = path.join(buildsDir, 'easycall-signing.jks');
  const passFile = path.join(buildsDir, '.ks-secret');

  let pass = '';
  if (fs.existsSync(passFile)) {
    pass = fs.readFileSync(passFile, 'utf8').trim();
  }
  if (!pass) {
    pass = crypto.randomBytes(18).toString('hex');
    fs.writeFileSync(passFile, pass, { mode: 0o600 });
  }

  if (!fs.existsSync(keystorePath)) {
    await execFileAsync('keytool', [
      '-genkeypair',
      '-v',
      '-keystore',
      keystorePath,
      '-alias',
      'easycall',
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass',
      pass,
      '-keypass',
      pass,
      '-dname',
      'CN=EASY CALL, OU=Mobile, O=EASY CALL, L=Global, ST=Global, C=US',
    ]);
  }

  return { keystorePath, pass };
}

export async function compileDirectAndroidApk(
  cfg: ApkBuildConfig,
  rootDir: string,
  buildsDir: string,
  outputApkPath: string
): Promise<{ sizeBytes: number }> {
  const tc = await detectApkToolchain();
  if (!tc.available || !tc.aapt2Path || !tc.d8Path || !tc.zipalignPath || !tc.apksignerPath || !tc.androidJarPath) {
    throw new Error('Android SDK build tools or Java JDK are not available in this environment.');
  }

  const distDir = path.join(rootDir, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    throw new Error('Production web bundle (dist/index.html) not found.');
  }

  const targetUrl = (cfg.serverUrl || '').trim().replace(/\/+$/, '');
  let serverHost = '';
  try {
    if (targetUrl) serverHost = new URL(targetUrl).hostname;
  } catch {
    serverHost = '';
  }

  const workDir = path.join(buildsDir, '_apk_work');
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });

  try {
    const resDir = path.join(workDir, 'res');
    const assetsDir = path.join(workDir, 'assets');
    const wwwDir = path.join(assetsDir, 'www');
    const valuesDir = path.join(resDir, 'values');
    const rawResDir = path.join(resDir, 'raw');
    const mipmapDir = path.join(resDir, 'mipmap-xxxhdpi');
    const mipmapXxhdpiDir = path.join(resDir, 'mipmap-xxhdpi');
    const mipmapXhdpiDir = path.join(resDir, 'mipmap-xhdpi');
    const mipmapHdpiDir = path.join(resDir, 'mipmap-hdpi');
    const pkgRelPath = cfg.applicationId.replace(/\./g, '/');
    const srcDir = path.join(workDir, 'src', pkgRelPath);
    const genDir = path.join(workDir, 'gen');
    const classesDir = path.join(workDir, 'classes');
    const dexDir = path.join(workDir, 'dex');

    fs.mkdirSync(valuesDir, { recursive: true });
    fs.mkdirSync(rawResDir, { recursive: true });
    fs.mkdirSync(mipmapDir, { recursive: true });
    fs.mkdirSync(mipmapXxhdpiDir, { recursive: true });
    fs.mkdirSync(mipmapXhdpiDir, { recursive: true });
    fs.mkdirSync(mipmapHdpiDir, { recursive: true });
    fs.mkdirSync(wwwDir, { recursive: true });
    fs.mkdirSync(srcDir, { recursive: true });
    fs.mkdirSync(genDir, { recursive: true });
    fs.mkdirSync(classesDir, { recursive: true });
    fs.mkdirSync(dexDir, { recursive: true });

    // 1. Copy official Easy Call logo into all mipmap densities & custom ringtone into res/raw
    const icon512 = path.join(rootDir, 'public', 'pwa-512x512.png');
    const icon192 = path.join(rootDir, 'public', 'pwa-192x192.png');
    const hiResIcon = fs.existsSync(icon512) ? icon512 : icon192;
    const medResIcon = fs.existsSync(icon192) ? icon192 : icon512;
    if (fs.existsSync(hiResIcon)) {
      fs.copyFileSync(hiResIcon, path.join(mipmapDir, 'ic_launcher.png'));
      fs.copyFileSync(hiResIcon, path.join(mipmapXxhdpiDir, 'ic_launcher.png'));
    }
    if (fs.existsSync(medResIcon)) {
      fs.copyFileSync(medResIcon, path.join(mipmapXhdpiDir, 'ic_launcher.png'));
      fs.copyFileSync(medResIcon, path.join(mipmapHdpiDir, 'ic_launcher.png'));
    }
    const customRingtoneWav = path.join(rootDir, 'public', 'easycall-ringtone.wav');
    if (fs.existsSync(customRingtoneWav)) {
      fs.copyFileSync(customRingtoneWav, path.join(rawResDir, 'easycall_ringtone.wav'));
    }
    const ringtoneVariants = [
      'imo_velvet',
      'sunset_kalimba',
      'midnight_love',
      'crystal_dew',
      'golden_heart',
    ];
    for (const variant of ringtoneVariants) {
      const srcWav = path.join(rootDir, 'public', 'ringtones', `${variant}.wav`);
      if (fs.existsSync(srcWav)) {
        fs.copyFileSync(srcWav, path.join(rawResDir, `ringtone_${variant}.wav`));
      }
    }

    // 2. Copy compiled dist/ web app directly into APK assets/www/
    copyDistForApk(distDir, wwwDir);
    fs.writeFileSync(
      path.join(wwwDir, 'easycall-config.json'),
      JSON.stringify({ serverUrl: targetUrl }),
      'utf8'
    );

    // 3. Write strings.xml
    fs.writeFileSync(
      path.join(valuesDir, 'strings.xml'),
      `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${sanitizeXmlText(cfg.appName)}</string>
</resources>
`,
      'utf8'
    );

    // 4. Write AndroidManifest.xml
    const manifestPath = path.join(workDir, 'AndroidManifest.xml');
    fs.writeFileSync(
      manifestPath,
      `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${sanitizeXmlText(cfg.applicationId)}"
    android:versionCode="${cfg.versionCode}"
    android:versionName="${sanitizeXmlText(cfg.versionName)}">

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="33" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.DISABLE_KEYGUARD" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.MANAGE_OWN_CALLS" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />
    <uses-permission android:name="android.permission.READ_CONTACTS" />

    <uses-feature android:name="android.hardware.camera" android:required="false" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />

    <application
        android:allowBackup="false"
        android:hardwareAccelerated="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.DeviceDefault.Light.NoActionBar"
        android:usesCleartextTraffic="false">

        <activity
            android:name="${sanitizeXmlText(cfg.applicationId)}.MainActivity"
            android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
            android:exported="true"
            android:launchMode="singleTask"
            android:showWhenLocked="true"
            android:turnScreenOn="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <activity
            android:name="${sanitizeXmlText(cfg.applicationId)}.IncomingCallActivity"
            android:exported="false"
            android:launchMode="singleTop"
            android:excludeFromRecents="true"
            android:showWhenLocked="true"
            android:turnScreenOn="true"
            android:screenOrientation="portrait"
            android:theme="@android:style/Theme.DeviceDefault.NoActionBar" />

        <service
            android:name="${sanitizeXmlText(cfg.applicationId)}.EasyCallService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="dataSync" />

        <service
            android:name="${sanitizeXmlText(cfg.applicationId)}.EasyCallConnectionService"
            android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE"
            android:exported="true">
            <intent-filter>
                <action android:name="android.telecom.ConnectionService" />
            </intent-filter>
        </service>
    </application>
</manifest>
`,
      'utf8'
    );

    // 5. Write EasyCallService.java (background SSE listener + call/message notifications)
    const servicePath = path.join(srcDir, 'EasyCallService.java');
    fs.writeFileSync(
      servicePath,
      `package ${cfg.applicationId};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Person;
import android.app.Service;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import org.json.JSONObject;

public class EasyCallService extends Service {
    public static final String PREFS_NAME = "easycall_prefs";
    public static final String ACTION_START = "app.easycall.action.START";
    public static final String ACTION_STOP_RING = "app.easycall.action.STOP_RING";
    public static final String ACTION_DECLINE_CALL = "app.easycall.action.DECLINE_CALL";
    public static final String EXTRA_CALL_ID = "call_id";

    private static final String CHANNEL_BG = "easycall_bg_sync";
    private static final String CHANNEL_MSG = "easycall_messages";
    private static final String CHANNEL_CALL = "easycall_incoming_calls_v2";
    private static final String TELECOM_ACCOUNT_ID = "easycall_self_managed";
    private static final int FG_NOTIF_ID = 101;
    private static final int CALL_NOTIF_ID = 202;

    public static volatile boolean isAppForeground = false;
    private static volatile MediaPlayer activeMediaPlayer = null;
    private static volatile Ringtone activeRingtone = null;
    private static volatile Vibrator activeVibrator = null;
    private static volatile String activeRingingCallId = null;
    private static volatile String presentedCallId = null;

    private volatile boolean running = false;
    private volatile HttpURLConnection activeConn = null;
    private Thread workerThread = null;
    private ConnectivityManager.NetworkCallback netCallback = null;
    private int msgNotifSeq = 300;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels();
        ensurePhoneAccount(this);
        registerNetworkWatcher();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannels();
        startForegroundCompat();

        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP_RING.equals(action)) {
            stopRingingStatic(this);
        } else if (ACTION_DECLINE_CALL.equals(action)) {
            final String callId = intent.getStringExtra(EXTRA_CALL_ID);
            stopRingingStatic(this);
            IncomingCallActivity.dismissIfCallMatches(callId);
            EasyCallConnectionService.endTelecomCall(callId);
            if (callId != null && !callId.isEmpty()) {
                declineCallAsync(callId);
            }
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString("authToken", "");
        if (token == null || token.trim().isEmpty()) {
            running = false;
            stopSelf();
            return START_NOT_STICKY;
        }

        if (!running || workerThread == null || !workerThread.isAlive()) {
            running = true;
            workerThread = new Thread(new Runnable() {
                @Override
                public void run() {
                    runSseLoop();
                }
            }, "EasyCallBgStream");
            workerThread.start();
        }

        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        unregisterNetworkWatcher();
        stopRingingStatic(this);
        if (activeConn != null) {
            try {
                activeConn.disconnect();
            } catch (Throwable ignored) {
            }
            activeConn = null;
        }
        if (workerThread != null) {
            workerThread.interrupt();
            workerThread = null;
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void registerNetworkWatcher() {
        if (Build.VERSION.SDK_INT < 24) return;
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return;
            netCallback = new ConnectivityManager.NetworkCallback() {
                @Override
                public void onAvailable(Network network) {
                    // Force immediate reconnect if stream was idling on stale interface
                    final HttpURLConnection c = activeConn;
                    if (c != null) {
                        new Thread(new Runnable() {
                            @Override
                            public void run() {
                                try {
                                    c.disconnect();
                                } catch (Throwable ignored) {
                                }
                            }
                        }).start();
                    }
                }
            };
            cm.registerDefaultNetworkCallback(netCallback);
        } catch (Throwable ignored) {
        }
    }

    private void unregisterNetworkWatcher() {
        if (Build.VERSION.SDK_INT < 24 || netCallback == null) return;
        try {
            ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm != null) {
                cm.unregisterNetworkCallback(netCallback);
            }
        } catch (Throwable ignored) {
        }
        netCallback = null;
    }

    private void startForegroundCompat() {
        Notification.Builder nb = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_BG)
            : new Notification.Builder(this);

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(this, 10, openIntent, piFlags);

        nb.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle("EASY CALL")
          .setContentText("Ready for incoming calls & messages")
          .setOngoing(true)
          .setContentIntent(pi);

        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(FG_NOTIF_ID, nb.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(FG_NOTIF_ID, nb.build());
        }
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel bg = new NotificationChannel(CHANNEL_BG, "Background Connection", NotificationManager.IMPORTANCE_LOW);
        bg.setSound(null, null);
        bg.enableVibration(false);
        nm.createNotificationChannel(bg);

        NotificationChannel msg = new NotificationChannel(CHANNEL_MSG, "Messages & Alerts", NotificationManager.IMPORTANCE_HIGH);
        msg.enableVibration(true);
        nm.createNotificationChannel(msg);

        NotificationChannel call = new NotificationChannel(CHANNEL_CALL, "Incoming Calls (Full Screen)", NotificationManager.IMPORTANCE_HIGH);
        call.setSound(null, null);
        call.enableVibration(false);
        call.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        call.setBypassDnd(true);
        nm.createNotificationChannel(call);
    }

    private void runSseLoop() {
        int backoffMs = 500;
        while (running) {
            HttpURLConnection conn = null;
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                String serverUrl = prefs.getString("serverUrl", "").replaceAll("/+$", "");
                String token = prefs.getString("authToken", "");
                if (serverUrl.isEmpty() || token.isEmpty()) {
                    running = false;
                    stopSelf();
                    return;
                }

                URL url = new URL(serverUrl + "/api/events/stream");
                conn = (HttpURLConnection) url.openConnection();
                activeConn = conn;
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Accept", "text/event-stream");
                conn.setRequestProperty("X-Requested-With", "EasyCallClient");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(18000);

                int code = conn.getResponseCode();
                if (code == 401) {
                    prefs.edit().remove("authToken").apply();
                    running = false;
                    stopSelf();
                    return;
                }
                if (code != 200) {
                    throw new RuntimeException("HTTP " + code);
                }

                backoffMs = 500;
                BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), "UTF-8"));
                String line;
                while (running && (line = reader.readLine()) != null) {
                    if (line.startsWith("data:")) {
                        String json = line.substring(5).trim();
                        if (!json.isEmpty()) {
                            handleSseEvent(json);
                        }
                    }
                }
            } catch (Throwable ignored) {
            } finally {
                if (activeConn == conn) {
                    activeConn = null;
                }
                if (conn != null) {
                    try {
                        conn.disconnect();
                    } catch (Throwable ignored) {
                    }
                }
            }

            if (!running) break;
            try {
                Thread.sleep(backoffMs);
            } catch (InterruptedException e) {
                break;
            }
            backoffMs = Math.min(4000, backoffMs * 2);
        }
    }

    private void handleSseEvent(String json) {
        try {
            JSONObject obj = new JSONObject(json);
            String type = obj.optString("type", "");
            if ("call:incoming".equals(type)) {
                String callId = obj.optString("callId", "");
                String callType = obj.optString("callType", "audio");
                JSONObject caller = obj.optJSONObject("caller");
                String callerName = caller != null ? caller.optString("displayName", "") : "";
                String callerPhone = caller != null ? caller.optString("phoneE164", "") : "";
                if (callerName.isEmpty()) {
                    callerName = !callerPhone.isEmpty() ? callerPhone : "Incoming Call";
                }
                if (!isAppForeground && !callId.isEmpty() && !callId.equals(activeRingingCallId)) {
                    showIncomingCallAlert(callId, callerName, callerPhone, "video".equals(callType));
                }
            } else if ("call:ended".equals(type) || "call:rejected".equals(type)) {
                String callId = obj.optString("callId", "");
                stopRingingStatic(this);
                IncomingCallActivity.dismissIfCallMatches(callId);
                EasyCallConnectionService.endTelecomCall(callId);
            } else if ("call:accepted".equals(type)) {
                String callId = obj.optString("callId", "");
                stopRingingStatic(this);
                IncomingCallActivity.dismissIfCallMatches(callId);
                EasyCallConnectionService.setTelecomCallActive(callId);
            } else if ("chat:message".equals(type)) {
                if (!isAppForeground) {
                    String senderName = obj.optString("senderName", "EASY CALL");
                    JSONObject msg = obj.optJSONObject("message");
                    String body = msg != null ? msg.optString("body", "") : "";
                    if (body.isEmpty()) {
                        body = "Sent a photo";
                    }
                    showMessageNotification(senderName, body);
                }
            } else if ("friend_request:new".equals(type)) {
                if (!isAppForeground) {
                    JSONObject fromUser = obj.optJSONObject("fromUser");
                    String name = fromUser != null ? fromUser.optString("displayName", "Someone") : "Someone";
                    showMessageNotification("New Connection", name + " wants to connect on EASY CALL");
                }
            }
        } catch (Throwable ignored) {
        }
    }

    public static PhoneAccountHandle getPhoneAccountHandle(Context ctx) {
        ComponentName cn = new ComponentName(ctx, EasyCallConnectionService.class);
        return new PhoneAccountHandle(cn, TELECOM_ACCOUNT_ID);
    }

    public static void ensurePhoneAccount(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        try {
            TelecomManager tm = (TelecomManager) ctx.getSystemService(Context.TELECOM_SERVICE);
            if (tm == null) return;
            PhoneAccountHandle handle = getPhoneAccountHandle(ctx);
            PhoneAccount account = new PhoneAccount.Builder(handle, "EASY CALL")
                .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
                .addSupportedUriScheme(PhoneAccount.SCHEME_SIP)
                .build();
            tm.registerPhoneAccount(account);
        } catch (Throwable ignored) {
        }
    }

    @SuppressWarnings("deprecation")
    private void showIncomingCallAlert(final String callId, final String callerName, final String callerPhone, final boolean isVideo) {
        activeRingingCallId = callId;
        presentedCallId = null;
        startRinging();

        // Wake CPU and physically turn ON the locked screen display
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                try {
                    PowerManager.WakeLock screenWl = pm.newWakeLock(
                        PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                            | PowerManager.ACQUIRE_CAUSES_WAKEUP
                            | PowerManager.ON_AFTER_RELEASE,
                        "easycall:screen_wake"
                    );
                    screenWl.acquire(15000);
                } catch (Throwable ignored) {
                    PowerManager.WakeLock cpuWl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "easycall:incoming");
                    cpuWl.acquire(15000);
                }
            }
        } catch (Throwable ignored) {
        }

        // Use Android Telecom Self-Managed ConnectionService on API 26+ (same path as WhatsApp / imo / Messenger)
        // This gives OS-granted background activity launch & floating CallStyle heads-up without needing Draw Over Apps.
        boolean telecomTriggered = false;
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                ensurePhoneAccount(this);
                TelecomManager tm = (TelecomManager) getSystemService(Context.TELECOM_SERVICE);
                if (tm != null) {
                    Bundle extras = new Bundle();
                    extras.putString("callId", callId);
                    extras.putString("callerName", callerName);
                    extras.putString("callerPhone", callerPhone);
                    extras.putBoolean("isVideo", isVideo);
                    tm.addNewIncomingCall(getPhoneAccountHandle(this), extras);
                    telecomTriggered = true;
                }
            } catch (Throwable ignored) {
                telecomTriggered = false;
            }
        }

        if (telecomTriggered) {
            // Safety fallback if Telecom delays onShowIncomingCallUi() on certain OEM ROMs
            new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (callId.equals(activeRingingCallId) && !callId.equals(presentedCallId)) {
                        presentIncomingCallUiStatic(EasyCallService.this, callId, callerName, callerPhone, isVideo);
                    }
                }
            }, 250);
        } else {
            presentIncomingCallUiStatic(this, callId, callerName, callerPhone, isVideo);
        }
    }

    @SuppressWarnings("deprecation")
    public static synchronized void presentIncomingCallUiStatic(
        Context ctx,
        String callId,
        String callerName,
        String callerPhone,
        boolean isVideo
    ) {
        if (callId == null || callId.isEmpty() || !callId.equals(activeRingingCallId)) {
            return;
        }
        if (callId.equals(presentedCallId)) {
            return;
        }
        presentedCallId = callId;

        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);

        Intent fullScreenIntent = new Intent(ctx, IncomingCallActivity.class);
        fullScreenIntent.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_NO_USER_ACTION
        );
        fullScreenIntent.putExtra("callId", callId);
        fullScreenIntent.putExtra("callerName", callerName);
        fullScreenIntent.putExtra("callerPhone", callerPhone);
        fullScreenIntent.putExtra("isVideo", isVideo);
        PendingIntent fullScreenPi = PendingIntent.getActivity(ctx, 21, fullScreenIntent, piFlags);

        Intent answerIntent = new Intent(ctx, MainActivity.class);
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        answerIntent.putExtra("incomingCallId", callId);
        answerIntent.putExtra("autoAcceptCallId", callId);
        PendingIntent answerPi = PendingIntent.getActivity(ctx, 23, answerIntent, piFlags);

        Intent declineIntent = new Intent(ctx, EasyCallService.class);
        declineIntent.setAction(ACTION_DECLINE_CALL);
        declineIntent.putExtra(EXTRA_CALL_ID, callId);
        PendingIntent declinePi = PendingIntent.getService(ctx, 22, declineIntent, piFlags);

        Notification.Builder nb = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(ctx, CHANNEL_CALL)
            : new Notification.Builder(ctx);

        nb.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(callerName)
          .setContentText(isVideo ? "Incoming video call" : "Incoming audio call")
          .setPriority(Notification.PRIORITY_MAX)
          .setCategory(Notification.CATEGORY_CALL)
          .setVisibility(Notification.VISIBILITY_PUBLIC)
          .setColor(0xFF0F766E)
          .setOngoing(true)
          .setAutoCancel(false)
          .setContentIntent(fullScreenPi)
          .setFullScreenIntent(fullScreenPi, true);

        if (Build.VERSION.SDK_INT >= 31) {
            try {
                Person callerPerson = new Person.Builder()
                    .setName(callerName)
                    .setImportant(true)
                    .build();
                Notification.CallStyle callStyle = Notification.CallStyle
                    .forIncomingCall(callerPerson, declinePi, answerPi)
                    .setIsVideo(isVideo);
                nb.setStyle(callStyle);
            } catch (Throwable ignored) {
                nb.addAction(0, "Decline", declinePi)
                  .addAction(0, "Answer", answerPi);
            }
        } else {
            nb.addAction(0, "Decline", declinePi)
              .addAction(0, "Answer", answerPi);
        }

        nm.notify(CALL_NOTIF_ID, nb.build());

        try {
            ctx.startActivity(fullScreenIntent);
        } catch (Throwable ignored) {
        }
    }

    private void showMessageNotification(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 31, openIntent, piFlags);

        Notification.Builder nb = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_MSG)
            : new Notification.Builder(this);

        nb.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(title)
          .setContentText(text)
          .setPriority(Notification.PRIORITY_HIGH)
          .setDefaults(Notification.DEFAULT_ALL)
          .setAutoCancel(true)
          .setContentIntent(openPi);

        msgNotifSeq = msgNotifSeq >= 399 ? 300 : msgNotifSeq + 1;
        nm.notify(msgNotifSeq, nb.build());
    }

    private void startRinging() {
        try {
            stopRingingStatic(this);
            boolean customStarted = false;
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                String selectedRingtone = prefs.getString("ringtoneId", "imo_velvet");
                int rawId = R.raw.easycall_ringtone;
                if ("imo_velvet".equals(selectedRingtone)) {
                    rawId = R.raw.ringtone_imo_velvet;
                } else if ("sunset_kalimba".equals(selectedRingtone)) {
                    rawId = R.raw.ringtone_sunset_kalimba;
                } else if ("midnight_love".equals(selectedRingtone)) {
                    rawId = R.raw.ringtone_midnight_love;
                } else if ("crystal_dew".equals(selectedRingtone)) {
                    rawId = R.raw.ringtone_crystal_dew;
                } else if ("golden_heart".equals(selectedRingtone)) {
                    rawId = R.raw.ringtone_golden_heart;
                }
                MediaPlayer mp = new MediaPlayer();
                if (Build.VERSION.SDK_INT >= 21) {
                    mp.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build());
                }
                Uri customUri = Uri.parse("android.resource://" + getPackageName() + "/" + rawId);
                mp.setDataSource(this, customUri);
                mp.setLooping(true);
                mp.setVolume(1.0f, 1.0f);
                mp.prepare();
                mp.start();
                activeMediaPlayer = mp;
                customStarted = true;
            } catch (Throwable ignored) {
            }

            if (!customStarted) {
                Uri ringUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                if (ringUri != null) {
                    Ringtone rt = RingtoneManager.getRingtone(this, ringUri);
                    if (rt != null) {
                        if (Build.VERSION.SDK_INT >= 28) {
                            rt.setLooping(true);
                        }
                        if (Build.VERSION.SDK_INT >= 21) {
                            rt.setAudioAttributes(new AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                .build());
                        }
                        rt.play();
                        activeRingtone = rt;
                    }
                }
            }

            Vibrator vib = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vib != null && vib.hasVibrator()) {
                long[] pattern = new long[]{0, 600, 800};
                if (Build.VERSION.SDK_INT >= 26) {
                    vib.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vib.vibrate(pattern, 0);
                }
                activeVibrator = vib;
            }
        } catch (Throwable ignored) {
        }
    }

    public static void stopRingingStatic(Context ctx) {
        activeRingingCallId = null;
        presentedCallId = null;
        try {
            if (activeMediaPlayer != null) {
                if (activeMediaPlayer.isPlaying()) {
                    activeMediaPlayer.stop();
                }
                activeMediaPlayer.release();
                activeMediaPlayer = null;
            }
        } catch (Throwable ignored) {
        }
        try {
            if (activeRingtone != null) {
                activeRingtone.stop();
                activeRingtone = null;
            }
        } catch (Throwable ignored) {
        }
        try {
            if (activeVibrator != null) {
                activeVibrator.cancel();
                activeVibrator = null;
            }
        } catch (Throwable ignored) {
        }
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(CALL_NOTIF_ID);
            }
        } catch (Throwable ignored) {
        }
    }

    public static void declineCallStatic(final Context ctx, final String callId) {
        if (callId == null || callId.isEmpty()) return;
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
                    String serverUrl = prefs.getString("serverUrl", "").replaceAll("/+$", "");
                    String token = prefs.getString("authToken", "");
                    if (serverUrl.isEmpty() || token.isEmpty()) return;
                    URL url = new URL(serverUrl + "/api/calls/" + callId + "/decline");
                    HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                    conn.setRequestProperty("X-Requested-With", "EasyCallClient");
                    conn.setDoOutput(true);
                    conn.getOutputStream().write(new byte[0]);
                    conn.getResponseCode();
                    conn.disconnect();
                } catch (Throwable ignored) {
                }
            }
        }).start();
    }

    private void declineCallAsync(final String callId) {
        declineCallStatic(this, callId);
    }
}
`,
      'utf8'
    );

    // 5a. Write EasyCallConnectionService.java (Android Telecom self-managed VoIP service for WhatsApp/imo-style incoming calls)
    const connectionServicePath = path.join(srcDir, 'EasyCallConnectionService.java');
    fs.writeFileSync(
      connectionServicePath,
      `package ${cfg.applicationId};

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.telecom.Connection;
import android.telecom.ConnectionRequest;
import android.telecom.ConnectionService;
import android.telecom.DisconnectCause;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;

public class EasyCallConnectionService extends ConnectionService {
    private static volatile EasyCallConnection activeConnection = null;
    private static volatile String activeCallId = null;

    public static void setTelecomCallActive(String callId) {
        if (Build.VERSION.SDK_INT < 26) return;
        final EasyCallConnection conn = activeConnection;
        if (conn == null) return;
        if (callId == null || callId.isEmpty() || callId.equals(activeCallId)) {
            try {
                conn.setActive();
            } catch (Throwable ignored) {
            }
        }
    }

    public static void endTelecomCall(String callId) {
        if (Build.VERSION.SDK_INT < 26) return;
        final EasyCallConnection conn = activeConnection;
        if (conn == null) return;
        if (callId == null || callId.isEmpty() || callId.equals(activeCallId)) {
            activeConnection = null;
            activeCallId = null;
            try {
                conn.setDisconnected(new DisconnectCause(DisconnectCause.REMOTE));
                conn.destroy();
            } catch (Throwable ignored) {
            }
        }
    }

    private static Bundle extractCallExtras(ConnectionRequest request) {
        Bundle b = request != null ? request.getExtras() : null;
        if (b == null) return new Bundle();
        if (b.containsKey("callId")) return b;
        try {
            Bundle nested = b.getBundle(TelecomManager.EXTRA_INCOMING_CALL_EXTRAS);
            if (nested != null) return nested;
        } catch (Throwable ignored) {
        }
        return b;
    }

    @Override
    public Connection onCreateIncomingConnection(PhoneAccountHandle connectionManagerPhoneAccount, ConnectionRequest request) {
        Bundle extras = extractCallExtras(request);
        String callId = extras.getString("callId", "");
        String callerName = extras.getString("callerName", "Incoming Call");
        String callerPhone = extras.getString("callerPhone", "");
        boolean isVideo = extras.getBoolean("isVideo", false);

        EasyCallConnection conn = new EasyCallConnection(callId, callerName, callerPhone, isVideo);
        if (Build.VERSION.SDK_INT >= 26) {
            conn.setConnectionProperties(Connection.PROPERTY_SELF_MANAGED);
            conn.setAudioModeIsVoip(true);
        }
        String addressVal = !callerPhone.isEmpty() ? callerPhone : (!callId.isEmpty() ? callId : "easycall");
        conn.setAddress(Uri.fromParts("sip", addressVal, null), TelecomManager.PRESENTATION_ALLOWED);
        conn.setCallerDisplayName(callerName, TelecomManager.PRESENTATION_ALLOWED);
        conn.setInitializing();
        conn.setInitialized();
        conn.setRinging();

        activeConnection = conn;
        activeCallId = callId;
        return conn;
    }

    @Override
    public void onCreateIncomingConnectionFailed(PhoneAccountHandle connectionManagerPhoneAccount, ConnectionRequest request) {
        Bundle extras = extractCallExtras(request);
        String callId = extras.getString("callId", "");
        String callerName = extras.getString("callerName", "Incoming Call");
        String callerPhone = extras.getString("callerPhone", "");
        boolean isVideo = extras.getBoolean("isVideo", false);
        EasyCallService.presentIncomingCallUiStatic(getApplicationContext(), callId, callerName, callerPhone, isVideo);
    }

    private class EasyCallConnection extends Connection {
        private final String callId;
        private final String callerName;
        private final String callerPhone;
        private final boolean isVideo;

        EasyCallConnection(String callId, String callerName, String callerPhone, boolean isVideo) {
            this.callId = callId;
            this.callerName = callerName;
            this.callerPhone = callerPhone;
            this.isVideo = isVideo;
        }

        @Override
        public void onShowIncomingCallUi() {
            EasyCallService.presentIncomingCallUiStatic(
                getApplicationContext(),
                callId,
                callerName,
                callerPhone,
                isVideo
            );
        }

        @Override
        public void onAnswer() {
            handleAnswer();
        }

        @Override
        public void onAnswer(int videoState) {
            handleAnswer();
        }

        private void handleAnswer() {
            EasyCallService.stopRingingStatic(getApplicationContext());
            try {
                setActive();
            } catch (Throwable ignored) {
            }
            try {
                Intent main = new Intent(getApplicationContext(), MainActivity.class);
                main.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                main.putExtra("incomingCallId", callId);
                main.putExtra("autoAcceptCallId", callId);
                getApplicationContext().startActivity(main);
            } catch (Throwable ignored) {
            }
        }

        @Override
        public void onReject() {
            handleReject();
        }

        @Override
        public void onReject(int rejectReason) {
            handleReject();
        }

        @Override
        public void onReject(String replyMessage) {
            handleReject();
        }

        private void handleReject() {
            EasyCallService.stopRingingStatic(getApplicationContext());
            IncomingCallActivity.dismissIfCallMatches(callId);
            EasyCallService.declineCallStatic(getApplicationContext(), callId);
            if (activeConnection == this) {
                activeConnection = null;
                activeCallId = null;
            }
            try {
                setDisconnected(new DisconnectCause(DisconnectCause.REJECTED));
                destroy();
            } catch (Throwable ignored) {
            }
        }

        @Override
        public void onDisconnect() {
            if (activeConnection == this) {
                activeConnection = null;
                activeCallId = null;
            }
            try {
                setDisconnected(new DisconnectCause(DisconnectCause.LOCAL));
                destroy();
            } catch (Throwable ignored) {
            }
        }
    }
}
`,
      'utf8'
    );

    // 5b. Write IncomingCallActivity.java (instant native lock-screen & pop-up call UI)
    const incomingCallPath = path.join(srcDir, 'IncomingCallActivity.java');
    fs.writeFileSync(
      incomingCallPath,
      `package ${cfg.applicationId};

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.LinearLayout;
import android.widget.TextView;

public class IncomingCallActivity extends Activity {
    private static volatile IncomingCallActivity activeInstance = null;
    private static volatile String activeCallId = null;

    private String callId = "";
    private PowerManager.WakeLock wakeLock = null;

    public static void dismissIfCallMatches(final String endedCallId) {
        final IncomingCallActivity inst = activeInstance;
        if (inst == null) return;
        if (endedCallId == null || endedCallId.isEmpty() || endedCallId.equals(activeCallId)) {
            inst.runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!inst.isFinishing()) {
                        inst.finish();
                    }
                }
            });
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
                | WindowManager.LayoutParams.FLAG_ALLOW_LOCK_WHILE_SCREEN_ON
        );

        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK
                        | PowerManager.ACQUIRE_CAUSES_WAKEUP
                        | PowerManager.ON_AFTER_RELEASE,
                    "easycall:call_screen"
                );
                wakeLock.acquire(45000);
            }
        } catch (Throwable ignored) {
        }

        Intent intent = getIntent();
        callId = intent != null && intent.getStringExtra("callId") != null ? intent.getStringExtra("callId") : "";
        String callerName = intent != null && intent.getStringExtra("callerName") != null ? intent.getStringExtra("callerName") : "Incoming Call";
        String callerPhone = intent != null && intent.getStringExtra("callerPhone") != null ? intent.getStringExtra("callerPhone") : "";
        boolean isVideo = intent != null && intent.getBooleanExtra("isVideo", false);

        activeInstance = this;
        activeCallId = callId;

        float dp = getResources().getDisplayMetrics().density;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);
        GradientDrawable bg = new GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            new int[]{Color.parseColor("#0B1623"), Color.parseColor("#0D3331"), Color.parseColor("#09111B")}
        );
        root.setBackground(bg);
        int padH = (int) (24 * dp);
        int padTop = (int) (64 * dp);
        int padBot = (int) (56 * dp);
        root.setPadding(padH, padTop, padH, padBot);

        TextView badge = new TextView(this);
        badge.setText(isVideo ? "EASY CALL · INCOMING VIDEO CALL" : "EASY CALL · INCOMING AUDIO CALL");
        badge.setTextColor(Color.parseColor("#5EEAD4"));
        badge.setTextSize(12f);
        badge.setTypeface(Typeface.DEFAULT_BOLD);
        badge.setGravity(Gravity.CENTER);
        root.addView(badge);

        View topSpacer = new View(this);
        topSpacer.setLayoutParams(new LinearLayout.LayoutParams(1, 0, 1f));
        root.addView(topSpacer);

        String initial = callerName.trim().isEmpty() ? "?" : callerName.trim().substring(0, 1).toUpperCase();
        TextView avatar = new TextView(this);
        avatar.setText(initial);
        avatar.setTextColor(Color.WHITE);
        avatar.setTextSize(42f);
        avatar.setTypeface(Typeface.DEFAULT_BOLD);
        avatar.setGravity(Gravity.CENTER);
        GradientDrawable avatarBg = new GradientDrawable();
        avatarBg.setShape(GradientDrawable.OVAL);
        avatarBg.setColor(Color.parseColor("#0F766E"));
        avatarBg.setStroke((int) (4 * dp), Color.parseColor("#2DD4BF"));
        avatar.setBackground(avatarBg);
        int avatarSize = (int) (124 * dp);
        LinearLayout.LayoutParams avParams = new LinearLayout.LayoutParams(avatarSize, avatarSize);
        avParams.bottomMargin = (int) (24 * dp);
        avatar.setLayoutParams(avParams);
        root.addView(avatar);

        TextView nameTv = new TextView(this);
        nameTv.setText(callerName);
        nameTv.setTextColor(Color.WHITE);
        nameTv.setTextSize(28f);
        nameTv.setTypeface(Typeface.DEFAULT_BOLD);
        nameTv.setGravity(Gravity.CENTER);
        root.addView(nameTv);

        if (!callerPhone.isEmpty() && !callerPhone.equals(callerName)) {
            TextView phoneTv = new TextView(this);
            phoneTv.setText(callerPhone);
            phoneTv.setTextColor(Color.parseColor("#94A3B8"));
            phoneTv.setTextSize(15f);
            phoneTv.setGravity(Gravity.CENTER);
            LinearLayout.LayoutParams phParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            );
            phParams.topMargin = (int) (6 * dp);
            phoneTv.setLayoutParams(phParams);
            root.addView(phoneTv);
        }

        TextView statusTv = new TextView(this);
        statusTv.setText("Ringing...");
        statusTv.setTextColor(Color.parseColor("#A7F3D0"));
        statusTv.setTextSize(16f);
        statusTv.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams stParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        stParams.topMargin = (int) (14 * dp);
        statusTv.setLayoutParams(stParams);
        root.addView(statusTv);

        View botSpacer = new View(this);
        botSpacer.setLayoutParams(new LinearLayout.LayoutParams(1, 0, 1.3f));
        root.addView(botSpacer);

        LinearLayout btnRow = new LinearLayout(this);
        btnRow.setOrientation(LinearLayout.HORIZONTAL);
        btnRow.setGravity(Gravity.CENTER);
        btnRow.setLayoutParams(new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        ));

        btnRow.addView(createActionButton("Decline", Color.parseColor("#E11D48"), dp, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                Intent declineSvc = new Intent(IncomingCallActivity.this, EasyCallService.class);
                declineSvc.setAction(EasyCallService.ACTION_DECLINE_CALL);
                declineSvc.putExtra(EasyCallService.EXTRA_CALL_ID, callId);
                startService(declineSvc);
                finish();
            }
        }));

        View gap = new View(this);
        gap.setLayoutParams(new LinearLayout.LayoutParams((int) (64 * dp), 1));
        btnRow.addView(gap);

        btnRow.addView(createActionButton("Answer", Color.parseColor("#059669"), dp, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                EasyCallService.stopRingingStatic(IncomingCallActivity.this);
                EasyCallConnectionService.setTelecomCallActive(callId);
                try {
                    if (Build.VERSION.SDK_INT >= 26) {
                        KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                        if (km != null) {
                            km.requestDismissKeyguard(IncomingCallActivity.this, null);
                        }
                    }
                } catch (Throwable ignored) {
                }
                Intent main = new Intent(IncomingCallActivity.this, MainActivity.class);
                main.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                main.putExtra("incomingCallId", callId);
                main.putExtra("autoAcceptCallId", callId);
                startActivity(main);
                finish();
            }
        }));

        root.addView(btnRow);
        setContentView(root);
    }

    private LinearLayout createActionButton(String label, int circleColor, float dp, View.OnClickListener listener) {
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER);
        col.setOnClickListener(listener);

        TextView circle = new TextView(this);
        circle.setText("Decline".equals(label) ? "✕" : "✓");
        circle.setTextColor(Color.WHITE);
        circle.setTextSize(28f);
        circle.setTypeface(Typeface.DEFAULT_BOLD);
        circle.setGravity(Gravity.CENTER);
        GradientDrawable gd = new GradientDrawable();
        gd.setShape(GradientDrawable.OVAL);
        gd.setColor(circleColor);
        circle.setBackground(gd);
        int size = (int) (74 * dp);
        circle.setLayoutParams(new LinearLayout.LayoutParams(size, size));
        col.addView(circle);

        TextView txt = new TextView(this);
        txt.setText(label);
        txt.setTextColor(Color.WHITE);
        txt.setTextSize(15f);
        txt.setTypeface(Typeface.DEFAULT_BOLD);
        txt.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        lp.topMargin = (int) (10 * dp);
        txt.setLayoutParams(lp);
        col.addView(txt);
        return col;
    }

    @Override
    protected void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
            activeCallId = null;
        }
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Throwable ignored) {
        }
        super.onDestroy();
    }
}
`,
      'utf8'
    );

    // 6. Write MainActivity.java serving bundled assets/www/ on https://easycall.app/
    const mainActivityPath = path.join(srcDir, 'MainActivity.java');
    fs.writeFileSync(
      mainActivityPath,
      `package ${cfg.applicationId};

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.database.Cursor;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.ContactsContract;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://easycall.app/";
    private static final String APP_HOST = "easycall.app";
    private static final String SERVER_HOST = "${escapeJavaString(serverHost)}";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int FILE_CHOOSER_CODE = 1002;

    private static volatile String pendingAutoAcceptCallId = "";

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressWarnings("deprecation")
    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }
        getWindow().addFlags(
            WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );
        handleCallLaunchIntent(getIntent());

        try {
            final FrameLayout root = new FrameLayout(this);
            root.setBackgroundColor(Color.parseColor("#f8fafc"));
            root.setFitsSystemWindows(true);

            webView = new WebView(this);
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setDatabaseEnabled(true);
            settings.setMediaPlaybackRequiresUserGesture(false);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(true);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            webView.setNetworkAvailable(true);

            try {
                CookieManager cookieManager = CookieManager.getInstance();
                cookieManager.setAcceptCookie(true);
                cookieManager.setAcceptThirdPartyCookies(webView, true);
            } catch (Throwable ignored) {
            }

            webView.addJavascriptInterface(new EasyCallBridge(), "EasyCallNative");

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    try {
                        Uri uri = request != null ? request.getUrl() : null;
                        if (uri != null && APP_HOST.equalsIgnoreCase(uri.getHost())) {
                            return serveLocalAsset(uri.getPath());
                        }
                    } catch (Throwable ignored) {
                    }
                    return super.shouldInterceptRequest(view, request);
                }

                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    try {
                        Uri uri = request != null ? request.getUrl() : null;
                        if (uri == null) return false;
                        String host = uri.getHost() != null ? uri.getHost() : "";
                        if (APP_HOST.equalsIgnoreCase(host) || (!SERVER_HOST.isEmpty() && host.equalsIgnoreCase(SERVER_HOST))) {
                            return false;
                        }
                        startActivity(new Intent(Intent.ACTION_VIEW, uri));
                        return true;
                    } catch (Throwable ignored) {
                        return false;
                    }
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    try {
                        CookieManager.getInstance().flush();
                    } catch (Throwable ignored) {
                    }
                }
            });

            webView.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(final PermissionRequest request) {
                    if (request == null) return;
                    Uri origin = request.getOrigin();
                    String originHost = origin != null && origin.getHost() != null ? origin.getHost() : "";
                    final boolean allowed =
                        APP_HOST.equalsIgnoreCase(originHost) ||
                        (!SERVER_HOST.isEmpty() && originHost.equalsIgnoreCase(SERVER_HOST)) ||
                        originHost.endsWith(".onrender.com") ||
                        originHost.endsWith(".run.app");

                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            try {
                                if (allowed) {
                                    request.grant(request.getResources());
                                } else {
                                    request.deny();
                                }
                            } catch (Throwable ignored) {
                            }
                        }
                    });
                }

                @Override
                public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    if (filePathCallback != null) {
                        filePathCallback.onReceiveValue(null);
                    }
                    filePathCallback = callback;
                    try {
                        startActivityForResult(params.createIntent(), FILE_CHOOSER_CODE);
                        return true;
                    } catch (Throwable e) {
                        filePathCallback = null;
                        return false;
                    }
                }
            });

            root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            ));

            setContentView(root);

            root.post(new Runnable() {
                @Override
                public void run() {
                    try {
                        getWindow().setStatusBarColor(Color.parseColor("#ffffff"));
                        getWindow().setNavigationBarColor(Color.parseColor("#f8fafc"));
                        if (Build.VERSION.SDK_INT >= 30) {
                            WindowInsetsController ctrl = getWindow().getInsetsController();
                            if (ctrl != null) {
                                ctrl.setSystemBarsAppearance(
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS
                                );
                            }
                        } else {
                            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            });

            try {
                root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
                    @Override
                    public WindowInsets onApplyWindowInsets(View v, WindowInsets insets) {
                        try {
                            if (insets == null) return null;
                            if (Build.VERSION.SDK_INT >= 30) {
                                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars());
                                if (bars != null) {
                                    v.setPadding(bars.left, bars.top, bars.right, bars.bottom);
                                }
                                return WindowInsets.CONSUMED;
                            } else {
                                v.setPadding(
                                    insets.getSystemWindowInsetLeft(),
                                    insets.getSystemWindowInsetTop(),
                                    insets.getSystemWindowInsetRight(),
                                    insets.getSystemWindowInsetBottom()
                                );
                                return insets.consumeSystemWindowInsets();
                            }
                        } catch (Throwable ignored) {
                            return insets;
                        }
                    }
                });
            } catch (Throwable ignored) {
            }

            requestRuntimePermissions();
            webView.loadUrl(APP_ORIGIN);
        } catch (Throwable fatal) {
            TextView tv = new TextView(this);
            tv.setText("EASY CALL could not initialize WebView: " + String.valueOf(fatal.getMessage()));
            tv.setPadding(48, 96, 48, 48);
            tv.setTextColor(Color.BLACK);
            tv.setBackgroundColor(Color.WHITE);
            setContentView(tv);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        EasyCallService.isAppForeground = true;
        if (webView != null) {
            webView.setNetworkAvailable(true);
            webView.onResume();
            webView.evaluateJavascript("window.dispatchEvent(new Event('easycall:resume'))", null);
        }
    }

    @Override
    protected void onPause() {
        EasyCallService.isAppForeground = false;
        super.onPause();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallLaunchIntent(intent);
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('easycall:resume'))", null);
        }
    }

    private void handleCallLaunchIntent(Intent intent) {
        if (intent == null) return;
        String acceptId = intent.getStringExtra("autoAcceptCallId");
        if (acceptId != null && !acceptId.trim().isEmpty()) {
            pendingAutoAcceptCallId = acceptId.trim();
            EasyCallService.stopRingingStatic(this);
            try {
                if (Build.VERSION.SDK_INT >= 26) {
                    KeyguardManager km = (KeyguardManager) getSystemService(Context.KEYGUARD_SERVICE);
                    if (km != null) {
                        km.requestDismissKeyguard(this, null);
                    }
                }
            } catch (Throwable ignored) {
            }
            if (webView != null) {
                final String safeId = pendingAutoAcceptCallId.replace("'", "");
                webView.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('easycall:native-action', { detail: { action: 'accept', callId: '" + safeId + "' } }))",
                    null
                );
            }
        }
    }

    private class EasyCallBridge {
        @JavascriptInterface
        public void setSessionAuth(final String serverUrl, final String token, final String userId) {
            try {
                SharedPreferences prefs = getSharedPreferences(EasyCallService.PREFS_NAME, MODE_PRIVATE);
                prefs.edit()
                    .putString("serverUrl", serverUrl != null ? serverUrl.trim() : "")
                    .putString("authToken", token != null ? token.trim() : "")
                    .putString("userId", userId != null ? userId.trim() : "")
                    .apply();

                if (token != null && !token.trim().isEmpty()) {
                    EasyCallService.ensurePhoneAccount(MainActivity.this);
                    Intent svc = new Intent(MainActivity.this, EasyCallService.class);
                    svc.setAction(EasyCallService.ACTION_START);
                    if (Build.VERSION.SDK_INT >= 26) {
                        startForegroundService(svc);
                    } else {
                        startService(svc);
                    }
                }
            } catch (Throwable ignored) {
            }
        }

        @JavascriptInterface
        public String consumePendingAcceptCallId() {
            String val = pendingAutoAcceptCallId;
            pendingAutoAcceptCallId = "";
            return val != null ? val : "";
        }

        @JavascriptInterface
        public void clearSessionAuth() {
            try {
                SharedPreferences prefs = getSharedPreferences(EasyCallService.PREFS_NAME, MODE_PRIVATE);
                prefs.edit().remove("authToken").remove("userId").apply();
                stopService(new Intent(MainActivity.this, EasyCallService.class));
            } catch (Throwable ignored) {
            }
        }

        @JavascriptInterface
        public void stopRinging() {
            EasyCallService.stopRingingStatic(MainActivity.this);
        }

        @JavascriptInterface
        public void setRingtone(final String ringtoneId) {
            try {
                SharedPreferences prefs = getSharedPreferences(EasyCallService.PREFS_NAME, MODE_PRIVATE);
                prefs.edit()
                    .putString("ringtoneId", ringtoneId != null ? ringtoneId.trim() : "imo_velvet")
                    .apply();
            } catch (Throwable ignored) {
            }
        }

        @SuppressWarnings("deprecation")
        @JavascriptInterface
        public void setCallAudioMode(final boolean inCall, final boolean speakerOn) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                        if (am != null) {
                            if (inCall) {
                                am.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                                am.setSpeakerphoneOn(speakerOn);
                            } else {
                                am.setSpeakerphoneOn(false);
                                am.setMode(AudioManager.MODE_NORMAL);
                                am.abandonAudioFocus(null);
                            }
                        }
                        if (inCall) {
                            EasyCallConnectionService.setTelecomCallActive(null);
                            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        } else {
                            EasyCallConnectionService.endTelecomCall(null);
                            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            });
        }

        @SuppressWarnings("deprecation")
        @JavascriptInterface
        public void setSpeakerphone(final boolean speakerOn) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                        if (am != null) {
                            am.setSpeakerphoneOn(speakerOn);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public String getDeviceContactsJson() {
            Cursor cursor = null;
            try {
                if (checkSelfPermission(Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) {
                    return "[]";
                }
                cursor = getContentResolver().query(
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[] { ContactsContract.CommonDataKinds.Phone.NUMBER },
                    null,
                    null,
                    null
                );
                if (cursor == null) {
                    return "[]";
                }
                java.util.LinkedHashSet<String> seen = new java.util.LinkedHashSet<>();
                org.json.JSONArray arr = new org.json.JSONArray();
                int idx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                while (idx >= 0 && cursor.moveToNext() && seen.size() < 1200) {
                    String num = cursor.getString(idx);
                    if (num != null) {
                        String trimmed = num.trim();
                        if (!trimmed.isEmpty() && seen.add(trimmed)) {
                            arr.put(trimmed);
                        }
                    }
                }
                return arr.toString();
            } catch (Throwable ignored) {
                return "[]";
            } finally {
                if (cursor != null) {
                    try {
                        cursor.close();
                    } catch (Throwable ignored) {
                    }
                }
            }
        }
    }

    private WebResourceResponse serveLocalAsset(String rawPath) {
        String rel = (rawPath == null || rawPath.isEmpty() || "/".equals(rawPath))
            ? "index.html"
            : rawPath.replaceAll("^/+", "");

        if (rel.contains("..")) {
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", null, new ByteArrayInputStream(new byte[0]));
        }

        AssetManager am = getAssets();
        String assetPath = "www/" + rel;
        InputStream stream = null;
        try {
            stream = am.open(assetPath);
        } catch (Exception e) {
            if (!rel.contains(".")) {
                rel = "index.html";
                assetPath = "www/index.html";
                try {
                    stream = am.open(assetPath);
                } catch (Exception ignored) {
                }
            }
        }

        if (stream == null) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
        }

        String mime = guessMimeType(rel);
        Map<String, String> headers = new HashMap<>();
        headers.put("Access-Control-Allow-Origin", "https://easycall.app");
        headers.put("Cache-Control", "no-cache");
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, stream);
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".webmanifest")) return "application/manifest+json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    private void requestRuntimePermissions() {
        try {
            List<String> needed = new ArrayList<>();
            String[] perms = new String[] {
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.READ_CONTACTS
            };
            for (String p : perms) {
                if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) {
                    needed.add(p);
                }
            }
            if (Build.VERSION.SDK_INT >= 31) {
                if (checkSelfPermission("android.permission.BLUETOOTH_CONNECT") != PackageManager.PERMISSION_GRANTED) {
                    needed.add("android.permission.BLUETOOTH_CONNECT");
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                if (checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) {
                    needed.add("android.permission.POST_NOTIFICATIONS");
                }
            }
            if (!needed.isEmpty()) {
                requestPermissions(needed.toArray(new String[0]), PERMISSION_REQUEST_CODE);
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_CODE) {
            if (filePathCallback != null) {
                Uri[] results = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                filePathCallback.onReceiveValue(results);
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
`,
      'utf8'
    );

    // 7. Compile resources with aapt2
    const resZip = path.join(workDir, 'res.zip');
    await execFileAsync(tc.aapt2Path, ['compile', '--dir', resDir, '-o', resZip]);

    // 8. Link resources + AndroidManifest + bundled assets/www into unsigned.apk
    const unsignedApk = path.join(workDir, 'unsigned.apk');
    await execFileAsync(tc.aapt2Path, [
      'link',
      '-o',
      unsignedApk,
      '-I',
      tc.androidJarPath,
      '--manifest',
      manifestPath,
      '-R',
      resZip,
      '-A',
      assetsDir,
      '--java',
      genDir,
      '--min-sdk-version',
      '24',
      '--target-sdk-version',
      '33',
      '--auto-add-overlay',
    ]);

    // 9. Compile Java sources (R.java + EasyCallService.java + EasyCallConnectionService.java + IncomingCallActivity.java + MainActivity.java)
    const rJavaPath = path.join(genDir, pkgRelPath, 'R.java');
    const javaSources = [servicePath, connectionServicePath, incomingCallPath, mainActivityPath];
    if (fs.existsSync(rJavaPath)) {
      javaSources.unshift(rJavaPath);
    }
    await execFileAsync('javac', [
      '--release',
      '11',
      '-classpath',
      tc.androidJarPath,
      '-d',
      classesDir,
      ...javaSources,
    ]);

    // 9. Convert .class files to Dalvik classes.dex with d8
    const classFiles = collectClassFiles(classesDir);
    await execFileAsync(tc.d8Path, ['--min-api', '24', '--output', dexDir, ...classFiles]);

    // 10. Insert classes.dex into unsigned.apk preserving existing ZipInfo
    const dexPath = path.join(dexDir, 'classes.dex');
    const mergedApk = path.join(workDir, 'merged.apk');
    await execFileAsync('python3', [
      '-c',
      `import sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'r') as zin, zipfile.ZipFile(sys.argv[3], 'w') as zout:
    for info in zin.infolist():
        zout.writestr(info, zin.read(info.filename))
    zout.write(sys.argv[2], 'classes.dex', compress_type=zipfile.ZIP_DEFLATED)`,
      unsignedApk,
      dexPath,
      mergedApk,
    ]);

    // 11. Align APK with zipalign
    const alignedApk = path.join(workDir, 'aligned.apk');
    await execFileAsync(tc.zipalignPath, ['-f', '-p', '4', mergedApk, alignedApk]);

    // 12. Sign APK with apksigner
    const { keystorePath, pass } = await ensureSigningKeystore(buildsDir);
    await execFileAsync(tc.apksignerPath, [
      'sign',
      '--ks',
      keystorePath,
      '--ks-key-alias',
      'easycall',
      '--ks-pass',
      `pass:${pass}`,
      '--key-pass',
      `pass:${pass}`,
      '--out',
      outputApkPath,
      alignedApk,
    ]);

    await execFileAsync(tc.apksignerPath, ['verify', outputApkPath]);

    const stat = fs.statSync(outputApkPath);
    return { sizeBytes: stat.size };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
