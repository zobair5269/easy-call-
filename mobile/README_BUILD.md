# EASY CALL Native Android & Apple iOS Build Guide

All source code, permissions, and signing templates for Android (`app.easycall.global`) and Apple iOS (`app.easycall.global`) are prepared in this directory.

## Why APK / IPA Binaries Must Be Built Outside Cloud Run
This Cloud Run Linux container runs Node.js without the Android SDK / Java JDK / Gradle toolchain and without macOS / Xcode / Apple signing certificates. To produce genuine, installable binaries without fabricating broken files:

## 1. Build `EASY_CALL_ANDROID.apk`
Requirements: Java JDK 17+, Android Studio / Android SDK (API 35).
1. Create `mobile/android/keystore.properties`:
   ```properties
   storeFile=easycall-release.jks
   storePassword=YOUR_STORE_PASSWORD
   keyAlias=easycall
   keyPassword=YOUR_KEY_PASSWORD
   ```
2. Generate keystore (one-time):
   `keytool -genkey -v -keystore mobile/android/app/easycall-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias easycall`
3. Run `bash mobile/build_android.sh`.
4. Output: `mobile/out/EASY_CALL_ANDROID.apk` (installable directly on Android phones) and `mobile/out/EASY_CALL_ANDROID.aab` (for Google Play).

## 2. Build `EASY_CALL_IOS.ipa`
Requirements: macOS with Xcode 15+, CocoaPods, and an Apple Developer Program account ($99/year).
1. Replace `YOUR_APPLE_TEAM_ID` in `mobile/ios/App/ExportOptions.plist` with your Apple Developer Team ID.
2. Run `bash mobile/build_ios.sh`.
3. Output: `mobile/out/EASY_CALL_IOS.ipa` signed for TestFlight / App Store Connect distribution (Apple iOS devices do not allow installing unsigned `.ipa` files).
