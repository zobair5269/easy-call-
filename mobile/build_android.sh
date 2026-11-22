#!/usr/bin/env bash
set -euo pipefail

# Builds signed release EASY_CALL_ANDROID.apk and EASY_CALL_ANDROID.aab
# Requires: Node.js, Java JDK 17+, Android SDK, and keystore.properties

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [ -f package.json ]; then
  echo "1. Building production web bundle..."
  npm run build
else
  echo "1. Using pre-built dist/ bundle..."
fi

echo "2. Installing Capacitor CLI & Android runtime..."
cd mobile
npm init -y >/dev/null 2>&1 || true
npm install @capacitor/core @capacitor/cli @capacitor/android

npx cap sync android
cd android
if [ ! -f gradlew ]; then
  gradle wrapper
fi
chmod +x gradlew
mkdir -p ../out

if [ -f keystore.properties ]; then
  ./gradlew assembleRelease bundleRelease
  cp app/build/outputs/apk/release/app-release.apk ../out/EASY_CALL_ANDROID.apk
  cp app/build/outputs/bundle/release/app-release.aab ../out/EASY_CALL_ANDROID.aab
  echo "Built:"
  echo "  mobile/out/EASY_CALL_ANDROID.apk"
  echo "  mobile/out/EASY_CALL_ANDROID.aab"
else
  ./gradlew assembleDebug
  cp app/build/outputs/apk/debug/app-debug.apk ../out/EASY_CALL_ANDROID.apk
  echo "Built installable APK (debug-signed; add keystore.properties for Play Store release):"
  echo "  mobile/out/EASY_CALL_ANDROID.apk"
fi
