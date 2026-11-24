"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "solar-switch-nav";
const MAX = 30;

function readStack(): string[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function writeStack(stack: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(stack.slice(-MAX)));
  } catch {
    // Private windows can refuse storage; Back then goes to the page above instead.
  }
}

/** The page one level up: a request goes back to its list, anything else to the workspace home. */
export function parentOf(path: string) {
  if (!path.startsWith("/dashboard/")) return "/dashboard";
  const up = path.replace(/\/[^/]+\/?$/, "");
  return up && up !== "/" ? up : "/dashboard";
}

/**
 * "← Back" under the staff header on every page except the workspace home. It returns to the
 * page you came from inside the app; opened directly (from a link or a notification), it goes
 * to the page one level up instead, so it never takes you out of the app.
 */
export function BackButton() {
  const path = usePathname() ?? "/dashboard";
  const router = useRouter();
  const [previous, setPrevious] = useState<string | null>(null);

  // Remember the pages visited in this tab, so Back knows where you came from.
  useEffect(() => {
    const stack = readStack();
    if (stack[stack.length - 1] === path) {
      // Same page again (a refresh): nothing to record.
    } else if (stack[stack.length - 2] === path) {
      // You went back, with this button or the phone's own back.
      stack.pop();
    } else {
      stack.push(path);
    }
    writeStack(stack);
    setPrevious(stack.length > 1 ? stack[stack.length - 2] : null);
  }, [path]);

  if (path === "/dashboard") return null;

  return (
    <div className="back-bar">
      <button
        type="button"
        className="back-button"
        onClick={() => (previous ? router.back() : router.push(parentOf(path)))}
      >
        <span aria-hidden="true">←</span> Back
      </button>
    </div>
  );
}
