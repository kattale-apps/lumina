"use client";

import type { FunctionArgs } from "convex/server";
import type { api } from "../../convex/_generated/api";

/**
 * The last energy check someone ran before they had an account. It stays on this phone so that,
 * after signing up, My recommendations can show the same options and send them in one tap.
 * Only the answers are kept, never results: options are worked out again from today's catalogue.
 */
const KEY = "solar-switch-pending-estimate";
/** Older checks are dropped: prices, stock and the person's needs move on. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type PendingEstimate = FunctionArgs<typeof api.estimator.recommend> & { savedAt: number };

export function savePendingEstimate(check: FunctionArgs<typeof api.estimator.recommend>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...check, savedAt: Date.now() }));
  } catch {
    // Private mode or storage off: the person can run the check again after signing up.
  }
}

export function readPendingEstimate(): PendingEstimate | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null") as PendingEstimate | null;
    if (!value || typeof value.savedAt !== "number" || !value.input || !value.grid) return null;
    if (Date.now() - value.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

export function clearPendingEstimate() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
