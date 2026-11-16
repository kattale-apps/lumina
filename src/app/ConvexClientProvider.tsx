"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { AppInbox } from "./AppInbox";
import { LanguageProvider } from "@/lib/i18n";

/**
 * No "Leave this page? Changes may not be saved" box anywhere in the app. The Convex client
 * shows one while a save is in flight, and the sign-in library while it refreshes a login;
 * in the Android app it pops up on ordinary page changes. Saves take a fraction of a second,
 * so the box helps nobody. This listener runs first and stops the others from asking.
 */
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => event.stopImmediatePropagation(), { capture: true });
}

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl, { unsavedChangesWarning: false }) : null;

export function ConvexClientProvider({
  children
}: {
  children: ReactNode;
}) {
  if (!convex) return <>{children}</>;

  return (
    <ConvexAuthProvider client={convex}>
      <AppInbox />
      <LanguageProvider>{children}</LanguageProvider>
    </ConvexAuthProvider>
  );
}
