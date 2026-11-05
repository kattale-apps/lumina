"use client";

import { useAppInboxRegistration } from "@/lib/appInbox";

/** Registers the Android app for the unread badge on its icon. Renders nothing. */
export function AppInbox() {
  useAppInboxRegistration();
  return null;
}
