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
      const result = await grant({ tenantId, email, role });
      const who = email.trim().toLowerCase();
      setNotice({
        ok: true,
        text: result && "invited" in result
          ? `Invitation saved for ${who}. Ask them to open the app, tap Staff sign in, then "Create your staff account" with this email. They get access as soon as they sign up.`
          : `Access granted to ${who}.`
      });
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
        Enter their work email and role. If they already have an account they get access now; if not, the email is
        invited and only an invited email can create an account. Accounts are for staff only for now.
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
        {busy ? "Adding…" : "Grant access or invite"}
      </button>
      <PendingInvites tenantId={tenantId} />
    </form>
  );
}

/** Invited emails that have not created their account yet. */
function PendingInvites({ tenantId }: { tenantId: Id<"tenants"> }) {
  const invites = useQuery(api.access.listInvites, { tenantId });
  const cancel = useMutation(api.access.cancelInvite);
  if (!invites || invites.length === 0) return null;
  return (
    <div className="pending-invites">
      <span className="response-label">Waiting to sign up ({invites.length})</span>
      <ul className="component-list">
        {invites.map((i) => (
          <li key={i.id}>
            <strong>{i.email}</strong>
            <span>
              {i.role.replace(/_/g, " ")} · invited {new Date(i.createdAt).toLocaleDateString("en-GB")} ·{" "}
              <button type="button" className="link-button" onClick={() => void cancel({ inviteId: i.id })}>Cancel</button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StaffList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const staff = useQuery(api.staff.listStaff, { tenantId });
  const changeRole = useMutation(api.staff.changeRole);
  const setAccess = useMutation(api.staff.setAccess);
  const setManager = useMutation(api.staff.setManager);
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
  const managers = staff.filter((p) => p.role === "sales_manager" && p.status === "active");

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
              {person.role === "sales_manager" ? (
                <span className="record-meta">
                  Team: {staff.filter((p) => p.managerUserId === person.userId).map((p) => p.displayName).join(", ") || "no agents yet"}
                </span>
              ) : null}
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
              {person.role === "sales_agent" ? (
                <>
                  <label className="visually-hidden" htmlFor={`mgr-${person.membershipId}`}>Manager for {person.displayName}</label>
                  <select
                    id={`mgr-${person.membershipId}`}
                    value={person.managerUserId ?? ""}
                    onChange={(e) => run(() => setManager({ membershipId: person.membershipId, managerUserId: (e.target.value || null) as Id<"userProfiles"> | null }))}
                  >
                    <option value="">No manager</option>
                    {managers.map((m) => (
                      <option key={m.userId} value={m.userId}>Manager: {m.displayName}</option>
                    ))}
                  </select>
                </>
              ) : null}
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
