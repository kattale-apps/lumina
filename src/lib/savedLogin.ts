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

/**
 * Runs one call against the secure storage plugin, giving up after a short wait.
 *
 * The plugin object is a Capacitor proxy that treats every property as a native method,
 * including `then`, so it must never be returned from an async function or awaited
 * itself: only the promise of a method call may be awaited.
 */
async function withStorage<T>(call: (storage: SecureStorageApi) => Promise<T>, fallback: T): Promise<T> {
  const mod = await import("@aparajita/capacitor-secure-storage");
  return Promise.race([
    call(mod.SecureStorage),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), 2000)),
  ]);
}

type SecureStorageApi = typeof import("@aparajita/capacitor-secure-storage").SecureStorage;

export async function readSavedLogin(): Promise<SavedLogin | null> {
  if (!savedLoginSupported()) return null;
  try {
    const raw = await withStorage((s) => s.getItem(KEY), null);
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
    await withStorage((s) => s.setItem(KEY, JSON.stringify(login)), undefined);
  } catch {
    // Saving is a convenience; signing in still worked.
  }
}

export async function forgetSavedLogin() {
  if (!savedLoginSupported()) return;
  try {
    await withStorage((s) => s.removeItem(KEY), undefined);
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
