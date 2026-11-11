"use client";

import { useEffect, useState } from "react";

const APK = "/download/solar-switch.apk";
const SIZE = "7.7 MB";

type Device = "android" | "iphone" | "other" | "app";

/**
 * "Get the Android app" for visitors on the website. Hidden inside the app itself;
 * iPhone visitors are told the website works for them instead.
 */
export function AppDownload() {
  const [device, setDevice] = useState<Device | null>(null);

  useEffect(() => {
    const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (cap?.isNativePlatform?.()) return setDevice("app");
    const ua = navigator.userAgent;
    setDevice(/android/i.test(ua) ? "android" : /iphone|ipad|ipod/i.test(ua) ? "iphone" : "other");
  }, []);

  // Wait until the device is known so the app never flashes its own download button.
  if (device === null || device === "app") return null;

  if (device === "iphone") {
    return (
      <p className="app-download-note">
        📱 Our app is for Android phones. On iPhone, keep using this website: it does everything the app does.
      </p>
    );
  }

  return (
    <div className="app-download">
      <a className="button button-secondary app-download-button" href={APK} download="Solar-Switch.apk">
        <span aria-hidden="true">📲</span> Get the Android app
      </a>
      <p className="app-download-meta">Free · {SIZE} · Android phones</p>
      <details className="app-download-help">
        <summary>How to install</summary>
        <ol>
          <li>Tap <strong>Get the Android app</strong> and wait for the download to finish.</li>
          <li>Open the downloaded file (Solar-Switch.apk) from the notification or your Downloads.</li>
          <li>If your phone asks, allow installing apps from your browser, then go back.</li>
          <li>Tap <strong>Install</strong>, then <strong>Open</strong>.</li>
        </ol>
        {device === "other" ? <p>On a computer? Open this page on your Android phone to download the app.</p> : null}
      </details>
    </div>
  );
}
