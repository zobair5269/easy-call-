#!/usr/bin/env bash
set -euo pipefail

# Builds signed EASY_CALL_IOS.ipa for TestFlight / App Store distribution
# Requires: macOS, Xcode 15+, CocoaPods, and an Apple Developer Program account

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "1. Building production web bundle..."
npm run build

echo "2. Installing Capacitor CLI & iOS runtime..."
cd mobile
npm init -y >/dev/null 2>&1 || true
npm install @capacitor/core @capacitor/cli @capacitor/ios

npx cap sync ios
cd ios/App
pod install

xcodebuild -workspace App.xcworkspace \
  -scheme App \
  -configuration Release \
  -archivePath ../../out/EasyCall.xcarchive \
  archive

xcodebuild -exportArchive \
  -archivePath ../../out/EasyCall.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath ../../out

mv ../../out/App.ipa ../../out/EASY_CALL_IOS.ipa
echo "Built: mobile/out/EASY_CALL_IOS.ipa"
