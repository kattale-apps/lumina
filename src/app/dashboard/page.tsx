"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super administrator",
  inventory_admin: "Inventory & pricing administrator",
  sales_manager: "Sales manager",
  technician: "Technician",
  sales_agent: "Sales agent"
};

const UPCOMING_MODULES = [
  { title: "Customers & assessments", phase: "Phase 2" },
  { title: "System designer", phase: "Phase 3" },
  { title: "Products & inventory", phase: "Phase 1" },
  { title: "Quotations & approvals", phase: "Phase 4" }
];

function SignOutButton() {
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
          await signOut();
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

function WorkspaceHeader() {
  return (
    <header className="topbar">
      <Link className="brand" href="/" aria-label="Lumina home">
        <span className="brand-mark">L</span>
        <span>LUMINA</span>
      </Link>
      <SignOutButton />
    </header>
  );
}

function StatusCard({
  eyebrow,
  title,
  children
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
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

function Workspace() {
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewerContext, isAuthenticated ? {} : "skip");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);

  if (isLoading || !isAuthenticated || viewer === undefined) {
    return (
      <StatusCard eyebrow="LUMINA WORKSPACE" title="Loading your workspace…">
        <p>Checking your account and company access.</p>
      </StatusCard>
    );
  }

  if (viewer.state === "signed_out") {
    return (
      <StatusCard eyebrow="LUMINA WORKSPACE" title="Your session has ended">
        <p>Please sign in again to continue.</p>
        <Link className="button" href="/sign-in">Go to sign in</Link>
      </StatusCard>
    );
  }

  if (viewer.state === "disabled" || viewer.state === "profile_missing") {
    return (
      <StatusCard eyebrow="ACCOUNT UNAVAILABLE" title="This account cannot be used">
        <p>
          Your Lumina account is disabled or incomplete. Contact your Lumina
          administrator for help.
        </p>
        <SignOutButton />
      </StatusCard>
    );
  }

  if (viewer.state === "awaiting_access") {
    return (
      <StatusCard eyebrow="ACCOUNT CREATED" title="Waiting for company access">
        <p>
          You are signed in as <strong>{viewer.profile.email ?? viewer.profile.displayName}</strong>,
          but you have not been added to a company yet.
        </p>
        <p>
          Ask your Lumina administrator to activate your membership and role. This
          page updates automatically once access is granted.
        </p>
        <SignOutButton />
      </StatusCard>
    );
  }

  return (
    <div className="shell">
      <WorkspaceHeader />
      <main className="workspace">
        <p className="eyebrow">WORKSPACE</p>
        <h1>Welcome, {viewer.profile.displayName}</h1>

        <section aria-labelledby="companies-heading" className="workspace-section">
          <h2 id="companies-heading">Your company access</h2>
          <ul className="company-list">
            {viewer.companies.map((company) => (
              <li className="company-card" key={company.tenantId}>
                <span className="company-name">{company.companyName}</span>
                <span className="company-role">{ROLE_LABELS[company.role] ?? company.role}</span>
                <span className="company-meta">Default currency: {company.defaultCurrency}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="modules-heading" className="workspace-section">
          <h2 id="modules-heading">Modules</h2>
          <ul className="module-grid">
            {UPCOMING_MODULES.map((module) => (
              <li className="module-card" key={module.title}>
                <h3>{module.title}</h3>
                <span className="module-state">Coming in {module.phase}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default function DashboardPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <StatusCard eyebrow="LUMINA WORKSPACE" title="Authentication is not configured yet">
        <p>Add the Convex deployment URL to the application environment before signing in.</p>
      </StatusCard>
    );
  }
  return <Workspace />;
}
