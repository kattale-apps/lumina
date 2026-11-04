"use client";

import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * Codes for quote requests sent before the person had an account. They stay on this phone
 * until the person signs in as a customer, then attach the requests to that account.
 */
const KEY = "solar-switch-pending-requests";

function read(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((t): t is string => typeof t === "string").slice(-20) : [];
  } catch {
    return [];
  }
}

export function rememberPendingRequest(token: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...read().filter((t) => t !== token), token].slice(-20)));
  } catch {
    // Private mode or storage off: staff can still reach them by phone.
  }
}

export function hasPendingRequests() {
  return read().length > 0;
}

/** Once a customer account is ready, attaches any requests made on this phone before signing up. */
export function useClaimPendingRequests(ready: boolean) {
  const claim = useMutation(api.responses.claimRequests);
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    const tokens = read();
    if (tokens.length === 0) return;
    done.current = true;
    claim({ tokens })
      .then(() => {
        try {
          localStorage.removeItem(KEY);
        } catch {
          // Nothing to clear.
        }
      })
      .catch(() => {
        done.current = false;
      });
  }, [ready, claim]);
}
