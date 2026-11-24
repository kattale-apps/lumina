"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CustomerShell } from "@/components/CustomerShell";
import { StaffFrame, useStaffRole } from "@/components/StaffFrame";
import { DraftNotice, LanguagePicker, useT } from "@/lib/i18n";

/**
 * Frame for the energy and upgrade checks. A signed-in customer keeps their account tabs, so the
 * checks feel part of the account; everyone else sees the public header with staff sign-in.
 */
export function PublicShell({ children }: { children: ReactNode }) {
  const t = useT();
  const me = useQuery(api.shop.myAccount, {});
  const staffRole = useStaffRole();
  if (staffRole) return <StaffFrame role={staffRole}>{children}</StaffFrame>;
  if (me?.signedIn && me.account) return <CustomerShell signedIn>{children}</CustomerShell>;
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
            <Link className="button button-small button-secondary" href="/sign-in">{t("estimate.staffSignIn")}</Link>
          </div>
        </header>
        <DraftNotice />
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
