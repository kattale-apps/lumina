"use client";

import { useEffect } from "react";

/** Registers the offline service worker in production builds only, so development reloads are never served from a cache. */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Without it the app still works online; offline pages just will not be saved.
    });
  }, []);
  return null;
}
