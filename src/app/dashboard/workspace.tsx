"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BackButton } from "@/components/BackButton";
import { useT } from "@/lib/i18n";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { idbAvailable, idbBackend } from "../../lib/offline/idb";
import { OfflineStore, pendingCount } from "../../lib/offline/store";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super administrator",
  inventory_admin: "Inventory & pricing administrator",
  sales_manager: "Sales manager",
  technician: "Technician",
  sales_agent: "Sales agent"
};

export type Role =
  | "super_admin"
  | "inventory_admin"
  | "sales_manager"
  | "technician"
  | "sales_agent";

export const ROLE_OPTIONS = Object.keys(ROLE_LABELS) as Role[];

/** Shows server-authored messages (ConvexError) and hides everything else. */
export function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "Something went wrong. Check your connection and try again.";
}

export function SignOutButton({ className = "button button-secondary" }: { className?: string }) {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className={className}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          // Work saved for offline use is removed from this device on sign-out, so warn before losing unsent changes.
          const local = idbAvailable() ? new OfflineStore(idbBackend) : null;
          if (local) {
            const unsent = pendingCount(await local.read().catch(() => ({ outbox: [], localCustomers: [], localSites: [], work: [] }) as never));
            if (unsent > 0 && !window.confirm(`${unsent} change(s) have not been sent yet and will be lost if you sign out. Sign out anyway?`)) {
              return;
            }
          }
          await signOut();
          await local?.clear().catch(() => undefined);
          router.replace("/sign-in");
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function WorkspaceHeader({ role }: { role?: string }) {
  const inbox = useQuery(api.inbox.myInbox, role ? {} : "skip");
  const unread: Record<string, number> = { "/dashboard/leads": inbox?.staff ?? 0, "/dashboard/item-requests": inbox?.items ?? 0 };
  const me = useQuery(api.profile.myProfile, {});
  const path = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  // Opening a page from the menu closes it.
  useEffect(() => setMenuOpen(false), [path]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  // Inventory administrators have no access to customer data.
  const crm = role !== undefined && role !== "inventory_admin";
  const links = [
    { group: "Sales", href: "/dashboard", label: "Home", show: true },
    { group: "Sales", href: "/dashboard/field", label: "Field work", show: crm },
    { group: "Sales", href: "/dashboard/leads", label: "Quote requests", show: true },
    { group: "Sales", href: "/dashboard/item-requests", label: "Item price requests", show: true },
    { group: "Sales", href: "/shop", label: "Shop (prices)", show: true },
    { group: "Sales", href: "/dashboard/orders", label: "Orders", show: role === "super_admin" || role === "sales_manager" || role === "sales_agent" },
    { group: "Sales", href: "/dashboard/invoices", label: "Invoices & receipts", show: role === "super_admin" || role === "sales_manager" || role === "sales_agent" },
    { group: "Sales", href: "/dashboard/record-book", label: "Sales record book", show: true },
    { group: "Sales", href: "/dashboard/sales-log", label: "Sales log", show: role === "super_admin" },
    { group: "Sales", href: "/dashboard/customers", label: "Customers", show: crm },
    { group: "Sales", href: "/dashboard/assessments", label: "Assessments", show: crm },
    { group: "Sales", href: "/dashboard/upgrades", label: "Upgrade checks", show: crm },
    { group: "Sales", href: "/dashboard/quotations", label: "Quotations", show: crm },
    { group: "Sales", href: "/dashboard/installations", label: "Installations", show: crm },
    { group: "Sales", href: "/dashboard/commissions", label: "Commissions", show: role === "super_admin" || role === "sales_manager" || role === "sales_agent" },
    { group: "Sales", href: "/dashboard/overview", label: "Overview", show: role === "super_admin" || role === "sales_manager" },
    { group: "Stock & catalogue", href: "/dashboard/appliances", label: "Appliances", show: crm },
    { group: "Stock & catalogue", href: "/dashboard/warehouses", label: "Warehouses", show: true },
    { group: "Stock & catalogue", href: "/dashboard/catalogue", label: "Catalogue", show: true },
    { group: "Stock & catalogue", href: "/dashboard/products", label: "Products", show: true },
    { group: "Stock & catalogue", href: "/dashboard/stock", label: "Stock", show: true },
    { group: "Stock & catalogue", href: "/dashboard/pricing", label: "Pricing", show: role === "super_admin" || role === "inventory_admin" },
    { group: "Team", href: "/dashboard/academy", label: "Academy", show: true },
    { group: "Team", href: "/dashboard/users", label: "Users", show: role === "super_admin" },
    { group: "Team", href: "/dashboard/staff", label: "Staff", show: role === "super_admin" },
    { group: "Team", href: "/dashboard/translations", label: "Translations", show: role === "super_admin" },
    { group: "Team", href: "/dashboard/settings", label: "Settings", show: role === "super_admin" }
  ];
  const visible = links.filter((link) => link.show);
  const groups = [...new Set(visible.map((link) => link.group))];
  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0);
  // The page you are on, including pages under it (a request opened from Quote requests).
  const current = visible
    .filter((link) => path === link.href || (link.href !== "/dashboard" && path?.startsWith(link.href + "/")))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <>
      {/* The menu bar floats at the top of the page, and the menu opens right under it. */}
      <div className="topbar-float">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Solar Switch home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
          <span>SOLAR SWITCH</span>
        </Link>
        <div className="topbar-actions">
          {me ? (
            <Link href="/profile" className="topbar-avatar" aria-label="My profile">
              <Avatar name={me.displayName} url={me.photoUrl} size="sm" />
            </Link>
          ) : null}
          {role ? (
            <button
              type="button"
              className={menuOpen ? "menu-button menu-button-open" : "menu-button"}
              aria-expanded={menuOpen}
              aria-controls="workspace-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <span className="menu-icon" aria-hidden="true">{menuOpen ? "✕" : "☰"}</span>
              <span>Menu</span>
              {totalUnread && !menuOpen ? <span className="menu-dot" aria-label={`${totalUnread} new`}>{totalUnread}</span> : null}
            </button>
          ) : (
            <SignOutButton />
          )}
        </div>
      </header>
      {role && menuOpen ? (
        <>
          <button type="button" className="menu-backdrop" aria-label="Close the menu" onClick={() => setMenuOpen(false)} />
          <nav id="workspace-menu" className="workspace-menu" aria-label="Workspace">
            {groups.map((group, gi) => (
              <div key={group} className="menu-group">
                <p className={`menu-group-title menu-tone-${(gi % 3) + 1}`}>{group}</p>
                {visible
                  .filter((link) => link.group === group)
                  .map((link) => (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={current === link.href ? "menu-link menu-link-on" : "menu-link"}
                      aria-current={current === link.href ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                    >
                      <span>{link.label}</span>
                      {unread[link.href] ? <span className="nav-count" aria-label={`${unread[link.href]} new`}>{unread[link.href]}</span> : null}
                    </Link>
                  ))}
              </div>
            ))}
            <div className="menu-group">
              <p className="menu-group-title menu-tone-4">Me</p>
              <Link href="/profile" className={path === "/profile" ? "menu-link menu-link-on" : "menu-link"} onClick={() => setMenuOpen(false)}>
                <span>My profile</span>
              </Link>
              {/* Staff can check their own energy needs or system and ask for a recommendation, like any customer. */}
              <Link href="/estimate" className="menu-link" onClick={() => setMenuOpen(false)}>
                <span>Check my energy needs</span>
              </Link>
              <Link href="/estimate/upgrade" className="menu-link" onClick={() => setMenuOpen(false)}>
                <span>Upgrade or fix my system</span>
              </Link>
              <Link href="/estimate/budget" className="menu-link" onClick={() => setMenuOpen(false)}>
                <span>What can my money buy?</span>
              </Link>
              <Link href="/my-requests" className="menu-link" onClick={() => setMenuOpen(false)}>
                <span>My recommendations</span>
              </Link>
              <SignOutButton className="menu-link menu-signout" />
            </div>
          </nav>
        </>
      ) : null}
      </div>
      {role ? <BackButton /> : null}
      {me && !me.complete && path !== "/profile" ? <ProfilePrompt /> : null}
    </>
  );
}

/** Shown on every page until the person has added a photo and their full name. */
export function ProfilePrompt() {
  const t = useT();
  return (
    <Link href="/profile" className="profile-prompt">
      <span aria-hidden="true">📷</span>
      <span>
        <strong>{t("profilePrompt.title")}</strong>
        <small>{t("profilePrompt.hint")}</small>
      </span>
      <span aria-hidden="true">›</span>
    </Link>
  );
}

export function StatusCard({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-live="polite">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

export type ActiveCompany = {
  tenantId: Id<"tenants">;
  companyName: string;
  defaultCurrency: string;
  role: string;
};

/**
 * Signed-in, company-scoped page. Anyone who is signed out or has no active
 * company is sent to the dashboard, which explains their situation. A user in
 * several companies works in the first; a company switcher comes later.
 */
export function CompanyPage({
  title,
  allowedRoles,
  children
}: {
  title: string;
  allowedRoles?: string[];
  children: (company: ActiveCompany) => ReactNode;
}) {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewerContext, isAuthenticated ? {} : "skip");

  const company = viewer?.state === "active" ? viewer.companies[0] : undefined;
  // Straight after a full page load the first answer can say "signed out" before the sign-in
  // token reaches the server; wait for the real answer instead of leaving the page.
  const settled = !isLoading && viewer !== undefined && viewer.state !== "signed_out";
  // Truly signed out, or no company access: the home page explains and signs in again.
  const redirect = (!isLoading && !isAuthenticated) || (settled && !company);

  useEffect(() => {
    if (redirect) router.replace("/dashboard");
  }, [redirect, router]);

  if (!settled || !company) {
    return (
      <StatusCard eyebrow="SOLAR SWITCH WORKSPACE" title="Loading…">
        <p>Checking your account and company access.</p>
      </StatusCard>
    );
  }

  if (allowedRoles && !allowedRoles.includes(company.role)) {
    return (
      <div className="shell">
        <WorkspaceHeader role={company.role} />
        <main className="workspace">
          <h1>{title}</h1>
          <p className="muted">Your role does not give you access to this page.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <WorkspaceHeader role={company.role} />
      <main className="workspace">
        <p className="eyebrow">{company.companyName.toUpperCase()}</p>
        <h1>{title}</h1>
        {children(company)}
      </main>
    </div>
  );
}

export function ConfiguredOnly({ children }: { children: ReactNode }) {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <StatusCard eyebrow="SOLAR SWITCH WORKSPACE" title="Authentication is not configured yet">
        <p>Add the Convex deployment URL to the application environment before signing in.</p>
      </StatusCard>
    );
  }
  return <>{children}</>;
}
