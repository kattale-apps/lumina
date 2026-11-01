"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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

export function SignOutButton() {
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      className="button button-secondary"
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
  // Inventory administrators have no access to customer data.
  const crm = role !== undefined && role !== "inventory_admin";
  const links = [
    { href: "/dashboard", label: "Home", show: true },
    { href: "/dashboard/field", label: "Field work", show: crm },
    { href: "/dashboard/customers", label: "Customers", show: crm },
    { href: "/dashboard/assessments", label: "Assessments", show: crm },
    { href: "/dashboard/quotations", label: "Quotations", show: crm },
    { href: "/dashboard/installations", label: "Installations", show: crm },
    { href: "/dashboard/commissions", label: "Commissions", show: role === "super_admin" || role === "sales_manager" || role === "sales_agent" },
    { href: "/dashboard/overview", label: "Overview", show: role === "super_admin" || role === "sales_manager" },
    { href: "/dashboard/appliances", label: "Appliances", show: crm },
    { href: "/dashboard/warehouses", label: "Warehouses", show: true },
    { href: "/dashboard/catalogue", label: "Catalogue", show: true },
    { href: "/dashboard/products", label: "Products", show: true },
    { href: "/dashboard/stock", label: "Stock", show: true },
    {
      href: "/dashboard/pricing",
      label: "Pricing",
      show: role === "super_admin" || role === "inventory_admin"
    },
    { href: "/dashboard/staff", label: "Staff", show: role === "super_admin" },
    { href: "/dashboard/settings", label: "Settings", show: role === "super_admin" }
  ];

  return (
    <>
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Lumina home">
          <span className="brand-mark">L</span>
          <span>LUMINA</span>
        </Link>
        <SignOutButton />
      </header>
      {role ? (
        <nav className="workspace-nav" aria-label="Workspace">
          {links
            .filter((link) => link.show)
            .map((link) => (
              <Link key={link.href} href={link.href}>
                {link.label}
              </Link>
            ))}
        </nav>
      ) : null}
    </>
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
  const settled = !isLoading && viewer !== undefined;
  const redirect = settled && !company;

  useEffect(() => {
    if (redirect) router.replace("/dashboard");
  }, [redirect, router]);

  if (!settled || !company) {
    return (
      <StatusCard eyebrow="LUMINA WORKSPACE" title="Loading…">
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
      <StatusCard eyebrow="LUMINA WORKSPACE" title="Authentication is not configured yet">
        <p>Add the Convex deployment URL to the application environment before signing in.</p>
      </StatusCard>
    );
  }
  return <>{children}</>;
}
