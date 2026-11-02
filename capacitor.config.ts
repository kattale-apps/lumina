import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app is a shell around the hosted web app, so one release of the
 * website updates every phone and the offline code is the same everywhere.
 * `appId` identifies the app in Google Play and cannot change after the first
 * upload: confirm it before publishing.
 */
const config: CapacitorConfig = {
  appId: "com.solarswitch.app",
  appName: "Solar Switch",
  webDir: "capacitor-www",
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? "https://lumina-xi-ochre-15.vercel.app/",
    cleartext: false,
    // Only the app's own address may load inside the shell.
    allowNavigation: []
  },
  android: {
    allowMixedContent: false,
    webContentsDebuggingEnabled: false
  }
};

export default config;
