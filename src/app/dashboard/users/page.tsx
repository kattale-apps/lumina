"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { Avatar } from "@/components/Avatar";
import { CompanyPage, ConfiguredOnly, ROLE_LABELS, ROLE_OPTIONS, errorMessage, type Role } from "../workspace";

type Person = FunctionReturnType<typeof api.users.listAllUsers>[number];
type Filter = "all" | "staff" | "customer" | "waiting";

const KIND_LABEL = { staff: "Staff", customer: "Customer", waiting: "Waiting for access" } as const;

function GrantAccess({ tenantId, person }: { tenantId: Id<"tenants">; person: Person }) {
  const grant = useMutation(api.staff.grantAccess);
  const [role, setRole] = useState<Role>("sales_agent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!person.email) return null;
  return (
    <div className="user-grant">
      <select aria-label={`Role for ${person.displayName}`} value={role} onChange={(e) => setRole(e.target.value as Role)}>
        {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
      </select>
      <button
        type="button"
        className="button button-small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await grant({ tenantId, email: person.email, role });
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Giving access…" : "Give staff access"}
      </button>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
    </div>
  );
}

function UserList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const people = useQuery(api.users.listAllUsers, { tenantId });
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c = { all: 0, staff: 0, customer: 0, waiting: 0 };
    for (const p of people ?? []) {
      c.all++;
      c[p.kind]++;
    }
    return c;
  }, [people]);

  if (!people) return <p className="muted">Loading users…</p>;
  const q = search.trim().toLowerCase();
  const shown = people.filter(
    (p) =>
      (filter === "all" || p.kind === filter) &&
      (!q || `${p.displayName} ${p.email} ${p.phone}`.toLowerCase().includes(q))
  );

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "Everyone" },
    { key: "staff", label: "Staff" },
    { key: "customer", label: "Customers" },
    { key: "waiting", label: "Waiting for access" }
  ];

  return (
    <section className="workspace-section">
      <p className="hint">
        Everyone with a Solar Switch account here: staff of this company, customers, and new accounts waiting for
        access. Manage staff roles on the <Link href="/dashboard/staff"><u>Staff</u></Link> page.
      </p>
      <nav className="customer-nav user-tabs" aria-label="Filter users">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            className={filter === t.key ? "customer-tab customer-tab-on" : "customer-tab"}
            aria-pressed={filter === t.key}
            onClick={() => setFilter(t.key)}
          >
            {t.label} <span className="user-tab-count">{counts[t.key]}</span>
          </button>
        ))}
      </nav>
      <input
        className="user-search"
        type="search"
        placeholder="Search by name, email or phone"
        aria-label="Search users"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {shown.length === 0 ? <p className="muted">No one matches.</p> : null}
      <ul className="record-list">
        {shown.map((p) => (
          <li key={p.userId}>
            <div className="record-card user-card">
              <Avatar name={p.displayName} url={p.photoUrl} size="md" />
              <div className="user-card-body">
                <span className="record-title">{p.displayName}</span>
                <span className="record-meta">{[p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"}</span>
                <span className="pill-row">
                  <span className={p.kind === "waiting" ? "pill pill-warn" : p.kind === "staff" ? "pill pill-info" : "pill pill-muted"}>
                    {p.kind === "staff" && p.role ? ROLE_LABELS[p.role] ?? p.role : KIND_LABEL[p.kind]}
                  </span>
                  {p.kind === "staff" && p.membershipStatus !== "active" ? <span className="pill pill-warn">{p.membershipStatus}</span> : null}
                  {p.accountStatus === "disabled" ? <span className="pill pill-warn">account disabled</span> : null}
                  {p.profileComplete ? <span className="pill pill-ok">Profile set up</span> : <span className="pill pill-muted">No photo yet</span>}
                </span>
                <span className="record-meta">Joined {new Date(p.joinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                {p.kind === "waiting" ? <GrantAccess tenantId={tenantId} person={p} /> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function UsersPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="All users" allowedRoles={["super_admin"]}>
        {(company) => <UserList tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
