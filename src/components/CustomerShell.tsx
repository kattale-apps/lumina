"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const TABS = [
  { href: "/my-requests", label: "My recommendations" },
  { href: "/shop", label: "Shop" },
  { href: "/estimate", label: "Power check" }
];

/** Page frame for signed-in customers: logo and sign-out on one line, then a row of tabs. */
export function CustomerShell({ children, signedIn }: { children: ReactNode; signedIn?: boolean }) {
  const { signOut } = useAuthActions();
  const path = usePathname();
  const inbox = useQuery(api.inbox.myInbox, signedIn ? {} : "skip");
  return (
    <div className="public-bg">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Solar Switch home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          {signedIn ? (
            <button className="button button-small button-secondary" type="button" onClick={() => void signOut()}>Sign out</button>
          ) : (
            <Link className="button button-small button-secondary" href="/sign-in">Sign in</Link>
          )}
        </header>
        {signedIn ? (
          <nav className="customer-nav" aria-label="Customer">
            {TABS.map((t) => (
              <Link key={t.href} href={t.href} className={path === t.href ? "customer-tab customer-tab-on" : "customer-tab"} aria-current={path === t.href ? "page" : undefined}>
                {t.label}
                {t.href === "/my-requests" && inbox?.customer ? <span className="nav-count" aria-label={`${inbox.customer} new`}>{inbox.customer}</span> : null}
              </Link>
            ))}
          </nav>
        ) : null}
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
