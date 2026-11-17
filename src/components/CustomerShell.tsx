"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ProfilePrompt } from "../app/dashboard/workspace";
import { DraftNotice, LanguagePicker, useT, type MessageKey } from "@/lib/i18n";

const TABS: { href: string; label: MessageKey }[] = [
  { href: "/my-requests", label: "customer.tabRecommendations" },
  { href: "/shop", label: "customer.tabShop" },
  { href: "/estimate", label: "customer.tabPowerCheck" },
  { href: "/estimate/upgrade", label: "customer.tabUpgradeCheck" },
  { href: "/profile", label: "customer.tabProfile" }
];

/** Page frame for signed-in customers: logo and sign-out on one line, then a row of tabs. */
export function CustomerShell({ children, signedIn }: { children: ReactNode; signedIn?: boolean }) {
  const t = useT();
  const { signOut } = useAuthActions();
  const path = usePathname();
  const inbox = useQuery(api.inbox.myInbox, signedIn ? {} : "skip");
  const me = useQuery(api.profile.myProfile, signedIn ? {} : "skip");
  return (
    <div className="public-bg">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label={t("common.brandHome")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <div className="topbar-actions">
            <LanguagePicker />
            {signedIn ? (
              <button className="button button-small button-secondary" type="button" onClick={() => void signOut()}>{t("common.signOut")}</button>
            ) : (
              <Link className="button button-small button-secondary" href="/sign-in">{t("common.signIn")}</Link>
            )}
          </div>
        </header>
        <DraftNotice />
        {signedIn ? (
          <nav className="customer-nav" aria-label="Customer">
            {TABS.map((tab) => (
              <Link key={tab.href} href={tab.href} className={path === tab.href ? "customer-tab customer-tab-on" : "customer-tab"} aria-current={path === tab.href ? "page" : undefined}>
                {t(tab.label)}
                {tab.href === "/my-requests" && inbox?.customer ? <span className="nav-count" aria-label={t("customer.newCount", { count: inbox.customer })}>{inbox.customer}</span> : null}
              </Link>
            ))}
          </nav>
        ) : null}
        {signedIn && me && !me.complete && path !== "/profile" ? <ProfilePrompt /> : null}
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
