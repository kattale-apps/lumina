"use client";

import { useEffect, useState } from "react";
import { Rich, useT } from "@/lib/i18n";

const APK = "/download/solar-switch.apk";
const SIZE = "7.7 MB";

type Device = "android" | "iphone" | "other" | "app";

/**
 * "Get the Android app" for visitors on the website. Hidden inside the app itself;
 * iPhone visitors are told the website works for them instead.
 */
export function AppDownload() {
  const t = useT();
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
        {t("app.iphone")}
      </p>
    );
  }

  return (
    <div className="app-download">
      <a className="button button-secondary app-download-button" href={APK} download="Solar-Switch.apk">
        <span aria-hidden="true">📲</span> {t("app.get")}
      </a>
      <p className="app-download-meta">{t("app.meta", { size: SIZE })}</p>
      <details className="app-download-help">
        <summary>{t("app.howTo")}</summary>
        <ol>
          <li><Rich text={t("app.step1")} /></li>
          <li>{t("app.step2")}</li>
          <li>{t("app.step3")}</li>
          <li><Rich text={t("app.step4")} /></li>
        </ol>
        {device === "other" ? <p>{t("app.computer")}</p> : null}
      </details>
    </div>
  );
}
