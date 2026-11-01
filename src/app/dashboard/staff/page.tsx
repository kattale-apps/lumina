"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  CompanyPage,
  ConfiguredOnly,
  ROLE_LABELS,
  ROLE_OPTIONS,
  errorMessage,
  type Role
} from "../workspace";

function RoleSelect({
  id,
  value,
  onChange,
  disabled
}: {
  id: string;
  value: string;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Role)}
    >
      {ROLE_OPTIONS.map((role) => (
        <option key={role} value={role}>
          {ROLE_LABELS[role]}
        </option>
      ))}
    </select>
  );
}

function AddStaff({ tenantId }: { tenantId: Id<"tenants"> }) {
  const grant = useMutation(api.staff.grantAccess);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("sales_agent");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await grant({ tenantId, email, role });
      setNotice({ ok: true, text: `Access granted to ${email.trim().toLowerCase()}.` });
      setEmail("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Add a staff member</h2>
      <p className="hint">
        They must first create an account on the sign-in page. Then enter the same email here.
      </p>
      <label htmlFor="staff-email">Work email</label>
      <input
        id="staff-email"
        type="email"
        required
        autoComplete="off"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <label htmlFor="staff-role">Role</label>
      <RoleSelect id="staff-role" value={role} onChange={setRole} />
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">
          {notice.text}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Grant access"}
      </button>
    </form>
  );
}

function StaffList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const staff = useQuery(api.staff.listStaff, { tenantId });
  const changeRole = useMutation(api.staff.changeRole);
  const setAccess = useMutation(api.staff.setAccess);
  const [error, setError] = useState("");

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  if (!staff) return <p className="muted">Loading staff…</p>;

  return (
    <section aria-labelledby="staff-heading" className="workspace-section">
      <h2 id="staff-heading">Staff ({staff.length})</h2>
      {error ? (
        <p className="auth-message" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="record-list">
        {staff.map((person) => (
          <li className="record-card" key={person.membershipId}>
            <div>
              <span className="record-title">
                {person.displayName}
                {person.isSelf ? " (you)" : ""}
              </span>
              <span className="record-meta">{person.email}</span>
              {person.status !== "active" ? (
                <span className="pill pill-warn">{person.status}</span>
              ) : null}
            </div>
            <div className="record-actions">
              <label className="visually-hidden" htmlFor={`role-${person.membershipId}`}>
                Role for {person.displayName}
              </label>
              <RoleSelect
                id={`role-${person.membershipId}`}
                value={person.role}
                disabled={person.isSelf}
                onChange={(role) => run(() => changeRole({ membershipId: person.membershipId, role }))}
              />
              {person.isSelf ? null : (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() =>
                    run(() =>
                      setAccess({
                        membershipId: person.membershipId,
                        status: person.status === "active" ? "suspended" : "active"
                      })
                    )
                  }
                >
                  {person.status === "active" ? "Suspend" : "Reactivate"}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function StaffPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Staff & roles" allowedRoles={["super_admin"]}>
        {(company) => (
          <>
            <AddStaff tenantId={company.tenantId} />
            <StaffList tenantId={company.tenantId} />
          </>
        )}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
