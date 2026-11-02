# Android packaging and release

The project in `android/` is a Capacitor shell that opens the production web app. It was generated and configured, **but no APK or bundle has been built or run on a device yet**: building needs the Android SDK and a JDK 17+, which are not set up on every machine.

## One-time setup
1. Install Android Studio (it includes the SDK) and JDK 17+.
2. Decide the **application id** in `capacitor.config.ts` (currently `com.solarswitch.app`). It identifies the app in Google Play and cannot be changed after the first upload.
3. Create an upload key (keep it out of git; back it up):
   `keytool -genkey -v -keystore solar-switch-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias solarswitch`
4. Create `android/keystore.properties` (ignored by git) with `storeFile`, `storePassword`, `keyAlias`, `keyPassword`, and read it from `android/app/build.gradle` in a `signingConfigs.release` block.
5. Replace the default launcher icons under `android/app/src/main/res/mipmap-*` with the Solar Switch mark (`public/icons/maskable-512.png` is a good source for Android Studio's Image Asset tool).

## Each release
1. Merge to `main`; wait for the Vercel production deployment to be **Ready** (the app loads the live site).
2. `npm run android:sync` to refresh the native project.
3. In Android Studio: raise `versionCode` and `versionName` in `android/app/build.gradle`, then **Build → Generate Signed Bundle** (`.aab`).
4. Install the debug build on a real phone and check, in airplane mode: open **Field work**, add a customer, start and save an assessment, reconnect and confirm it syncs.
5. Upload the `.aab` to a Google Play **internal testing** track first, then promote.

## Device checks before each release
- Sign in, open **Field work** while online, switch to airplane mode, relaunch the app: the screen opens and drafts are editable.
- Save a draft offline, reconnect: the banner shows the change sent; the draft appears under Assessments.
- Edit the same draft on the website while the phone is offline, then reconnect the phone: the phone shows "held for review" and the choice appears online.
- Sign out with unsent changes: the warning appears.

## Why a shell around the website
One codebase and one release for web and Android; no second copy of pricing, permission or approval logic on the phone. The trade-off is that the first launch needs a connection, and a change to the site address means a new app build.
