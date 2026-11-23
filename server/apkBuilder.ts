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

    <uses-sdk android:minSdkVersion="24" android:targetSdkVersion="34" />

    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CAMERA" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
    <uses-permission android:name="android.permission.USE_FULL_SCREEN_INTENT" />

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

        <service
            android:name="${sanitizeXmlText(cfg.applicationId)}.EasyCallService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="dataSync" />
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
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
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
    private static final String CHANNEL_CALL = "easycall_incoming_calls";
    private static final int FG_NOTIF_ID = 101;
    private static final int CALL_NOTIF_ID = 202;

    public static volatile boolean isAppForeground = false;
    private static volatile MediaPlayer activeMediaPlayer = null;
    private static volatile Ringtone activeRingtone = null;
    private static volatile Vibrator activeVibrator = null;
    private static volatile String activeRingingCallId = null;

    private volatile boolean running = false;
    private Thread workerThread = null;
    private int msgNotifSeq = 300;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels();
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
        stopRingingStatic(this);
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

        NotificationChannel msg = new NotificationChannel(CHANNEL_MSG, "Messages & Friend Requests", NotificationManager.IMPORTANCE_HIGH);
        msg.enableVibration(true);
        nm.createNotificationChannel(msg);

        NotificationChannel call = new NotificationChannel(CHANNEL_CALL, "Incoming Calls", NotificationManager.IMPORTANCE_HIGH);
        call.setSound(null, null);
        call.enableVibration(false);
        nm.createNotificationChannel(call);
    }

    private void runSseLoop() {
        int backoffMs = 2000;
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
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Authorization", "Bearer " + token);
                conn.setRequestProperty("Accept", "text/event-stream");
                conn.setRequestProperty("X-Requested-With", "EasyCallClient");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(45000);

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

                backoffMs = 2000;
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
            backoffMs = Math.min(12000, backoffMs * 2);
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
                String callerName = caller != null ? caller.optString("displayName", "Incoming Call") : "Incoming Call";
                if (callerName.isEmpty() && caller != null) {
                    callerName = caller.optString("phoneE164", "Incoming Call");
                }
                if (!isAppForeground && !callId.equals(activeRingingCallId)) {
                    showIncomingCallAlert(callId, callerName, "video".equals(callType));
                }
            } else if ("call:ended".equals(type) || "call:rejected".equals(type)) {
                stopRingingStatic(this);
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
                    showMessageNotification("New Friend Request", name + " wants to connect on EASY CALL");
                }
            }
        } catch (Throwable ignored) {
        }
    }

    private void showIncomingCallAlert(String callId, String callerName, boolean isVideo) {
        activeRingingCallId = callId;
        startRinging();

        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                PowerManager.WakeLock wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "easycall:incoming");
                wl.acquire(15000);
            }
        } catch (Throwable ignored) {
        }

        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;

        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);

        Intent fullIntent = new Intent(this, MainActivity.class);
        fullIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        fullIntent.putExtra("incomingCallId", callId);
        PendingIntent fullPi = PendingIntent.getActivity(this, 21, fullIntent, piFlags);

        Intent declineIntent = new Intent(this, EasyCallService.class);
        declineIntent.setAction(ACTION_DECLINE_CALL);
        declineIntent.putExtra(EXTRA_CALL_ID, callId);
        PendingIntent declinePi = PendingIntent.getService(this, 22, declineIntent, piFlags);

        Notification.Builder nb = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, CHANNEL_CALL)
            : new Notification.Builder(this);

        nb.setSmallIcon(R.mipmap.ic_launcher)
          .setContentTitle(isVideo ? "Incoming Video Call" : "Incoming Audio Call")
          .setContentText(callerName + " is calling...")
          .setPriority(Notification.PRIORITY_MAX)
          .setCategory(Notification.CATEGORY_CALL)
          .setOngoing(true)
          .setAutoCancel(true)
          .setContentIntent(fullPi)
          .setFullScreenIntent(fullPi, true)
          .addAction(0, "Answer", fullPi)
          .addAction(0, "Decline", declinePi);

        nm.notify(CALL_NOTIF_ID, nb.build());

        try {
            startActivity(fullIntent);
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

    private void declineCallAsync(final String callId) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
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
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
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

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        }

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
        if (webView != null) {
            webView.evaluateJavascript("window.dispatchEvent(new Event('easycall:resume'))", null);
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

        @JavascriptInterface
        public void setCallAudioMode(final boolean inCall, final boolean speakerOn) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                        if (am != null) {
                            if (inCall) {
                                am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                                am.setSpeakerphoneOn(speakerOn);
                            } else {
                                am.setSpeakerphoneOn(false);
                                am.setMode(AudioManager.MODE_NORMAL);
                            }
                        }
                        if (inCall) {
                            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        } else {
                            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            });
        }

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
                Manifest.permission.RECORD_AUDIO
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
      '34',
      '--auto-add-overlay',
    ]);

    // 9. Compile Java sources (R.java + EasyCallService.java + MainActivity.java)
    const rJavaPath = path.join(genDir, pkgRelPath, 'R.java');
    const javaSources = [servicePath, mainActivityPath];
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
