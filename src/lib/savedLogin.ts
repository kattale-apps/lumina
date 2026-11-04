/**
 * "Save my login on this phone", for the Android app only.
 *
 * The email and password are kept in the app's secure storage, encrypted with a key
 * held in the Android Keystore, so other apps cannot read them. Nothing is stored in
 * a normal browser, and older app builds without the plugin simply do not offer it.
 */

import { useCallback, useEffect, useState } from "react";

export type SavedLogin = { email: string; password: string };

const KEY = "solar-switch-login";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
};

export function savedLoginSupported() {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() && cap.isPluginAvailable?.("SecureStorage"));
}

async function storage() {
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  return SecureStorage;
}

export async function readSavedLogin(): Promise<SavedLogin | null> {
  if (!savedLoginSupported()) return null;
  try {
    // Never keep the sign-in form waiting on storage for more than a moment.
    const raw = await Promise.race([
      storage().then((s) => s.getItem(KEY)),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<SavedLogin>;
    return typeof value.email === "string" && typeof value.password === "string"
      ? { email: value.email, password: value.password }
      : null;
  } catch {
    // Unreadable (for example restored from a backup onto a new phone): start fresh.
    await forgetSavedLogin();
    return null;
  }
}

export async function writeSavedLogin(login: SavedLogin) {
  if (!savedLoginSupported()) return;
  try {
    await (await storage()).setItem(KEY, JSON.stringify(login));
  } catch {
    // Saving is a convenience; signing in still worked.
  }
}

export async function forgetSavedLogin() {
  if (!savedLoginSupported()) return;
  try {
    await (await storage()).removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** Whether this device can save logins, the saved login if any, and the user's choice to save. */
export function useSavedLogin() {
  const [supported, setSupported] = useState(false);
  const [saved, setSaved] = useState<SavedLogin | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    let live = true;
    const ok = savedLoginSupported();
    setSupported(ok);
    readSavedLogin().then((login) => {
      if (!live) return;
      setSaved(login);
      setRemember(Boolean(login));
      setLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Call after a successful sign-in or sign-up: saves or forgets according to the tick box. */
  const afterSuccess = useCallback(
    async (login: SavedLogin) => {
      if (!supported) return;
      if (remember) await writeSavedLogin(login);
      else await forgetSavedLogin();
    },
    [supported, remember]
  );

  const forget = useCallback(async () => {
    await forgetSavedLogin();
    setSaved(null);
    setRemember(false);
  }, []);

  return { supported, loaded, saved, remember, setRemember, afterSuccess, forget };
}
