"use client";

/**
 * Bridge to the Android app's "Inbox" plugin, which keeps the unread badge on the app icon.
 *
 * The plugin object is a Capacitor proxy that answers every property, including `then`, so it is
 * only ever used for direct method calls and never returned from an async function.
 */

import { useEffect, useRef } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type InboxPlugin = {
  getKey(): Promise<{ key: string | null; owner: string | null }>;
  setKey(options: { key: string; endpoint: string; owner: string }): Promise<void>;
  checkNow(): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
};

type CapacitorGlobal = { isNativePlatform?: () => boolean; isPluginAvailable?: (name: string) => boolean };

function available() {
  const cap = (globalThis as { Capacitor?: CapacitorGlobal }).Capacitor;
  return Boolean(cap?.isNativePlatform?.() && cap.isPluginAvailable?.("Inbox"));
}

let plugin: InboxPlugin | null = null;
async function withInbox<T>(call: (inbox: InboxPlugin) => Promise<T>): Promise<T | undefined> {
  if (!available()) return undefined;
  if (!plugin) {
    const { registerPlugin } = await import("@capacitor/core");
    plugin = registerPlugin<InboxPlugin>("Inbox");
  }
  try {
    return await Promise.race([
      call(plugin),
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000))
    ]);
  } catch {
    return undefined;
  }
}

/** Where the phone checks for new messages: the Convex HTTP address for this deployment. */
function endpoint() {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (site) return site.replace(/\/+$/, "") + "/app-inbox";
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? "";
  return url.replace(/\.convex\.cloud\/?$/, ".convex.site") + "/app-inbox";
}

/** Ask the phone to refresh the badge now, for example after messages were opened. */
export function refreshAppBadge() {
  void withInbox((inbox) => inbox.checkNow());
}

/**
 * Once someone is signed in on the Android app, gives the phone a key for background checks.
 * The phone keeps it after signing out, so the badge still shows before the next sign-in;
 * signing in as someone else replaces it.
 */
export function useAppInboxRegistration() {
  const { isAuthenticated } = useConvexAuth();
  const inbox = useQuery(api.inbox.myInbox, isAuthenticated ? {} : "skip");
  const register = useMutation(api.inbox.registerDevice);
  const doneFor = useRef<string | null>(null);
  const userId = inbox?.userId ?? null;

  useEffect(() => {
    if (!userId || doneFor.current === userId || !available()) return;
    doneFor.current = userId;
    void (async () => {
      const current = await withInbox((p) => p.getKey());
      if (current?.key && current.owner === userId) {
        await withInbox((p) => p.checkNow());
        return;
      }
      try {
        const fresh = await register({ previousKey: current?.key ?? undefined });
        await withInbox((p) => p.setKey({ key: fresh.key, endpoint: endpoint(), owner: fresh.userId }));
        await withInbox((p) => p.requestNotifications());
      } catch {
        doneFor.current = null;
      }
    })();
  }, [userId, register]);

  return inbox;
}

/** Marks messages as seen while this page is open, which clears the badge. */
export function useMarkSeen(kind: "customer" | "staff", ready: boolean, unread: number | undefined) {
  const markSeen = useMutation(api.inbox.markSeen);
  useEffect(() => {
    if (!ready) return;
    void markSeen({ kind }).then(refreshAppBadge).catch(() => undefined);
    // Run again when new items arrive while the page is open.
  }, [ready, kind, unread, markSeen]);
}
