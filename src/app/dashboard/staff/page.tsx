"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
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


type StaffRow = NonNullable<FunctionReturnType<typeof api.staff.listStaff>>[number];

/** Same rule as the server: a chosen brand covers longer names containing it as a word ("Lumina" covers "Lumina Solar"). */
function covers(chosen: Iterable<string>, key: string) {
  for (const c of chosen) {
    if (!c || c === key) continue;
    const escaped = c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(key)) return c;
  }
  return null;
}
type BrandChoice = FunctionReturnType<typeof api.staff.brandChoices>["brands"][number];

/**
 * The product brands a sales manager or agent may see. Managers start on Lumina only; an agent
 * follows their manager, and can be narrowed to fewer of the manager's brands.
 */
function BrandAccess({
  person,
  manager,
  choices,
  defaultBrands,
  onSave
}: {
  person: StaffRow;
  manager: StaffRow | null;
  choices: BrandChoice[];
  defaultBrands: string[];
  onSave: (brands: string[] | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!person.brands) return null;

  const nameOf = (key: string) => choices.find((c) => c.key === key)?.name ?? key;
  const isAgent = person.role === "sales_agent";
  const limit = isAgent && manager?.brands ? manager.brands.effective : null;
  const usingDefault = person.brands.chosen === null;
  const summary = person.brands.effective.length ? person.brands.effective.map(nameOf).join(", ") : "no brands";
  const defaultLabel = isAgent && manager ? `same as ${manager.displayName}` : `${defaultBrands.map(nameOf).join(", ")} only`;

  function start() {
    setPicked(person.brands!.effective);
    setError("");
    setOpen(true);
  }
  async function save(brands: string[] | null) {
    setBusy(true);
    setError("");
    try {
      await onSave(brands);
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="brand-access">
      <span className="record-meta">
        <strong>Brands:</strong> {summary}
        {usingDefault ? <span className="brand-default"> (default: {defaultLabel})</span> : null}
      </span>
      {open ? (
        <fieldset className="brand-picker">
          <legend>Brands {person.displayName} can see</legend>
          {limit ? (
            <p className="hint">Only {manager!.displayName}&apos;s brands can be chosen. Give the manager more brands to widen this list.</p>
          ) : null}
          {choices.length === 0 ? <p className="muted">There are no active products yet.</p> : null}
          <p className="hint">Each brand also covers longer brand names that contain it, so Lumina includes Lumina Solar.</p>
          {choices.map((c) => {
            const allowed = !limit || limit.includes(c.key) || covers(limit, c.key) !== null;
            // Already covered by another ticked brand, e.g. "Lumina Solar" when "Lumina" is ticked.
            const coveredBy = covers(picked, c.key);
            return (
              <label key={c.key} className={allowed ? "check-row" : "check-row brand-off"}>
                <input
                  type="checkbox"
                  disabled={!allowed || busy || coveredBy !== null}
                  checked={picked.includes(c.key) || coveredBy !== null}
                  onChange={(e) =>
                    setPicked((all) => (e.target.checked ? [...all, c.key] : all.filter((k) => k !== c.key)))
                  }
                />
                {c.name} <span className="record-meta">({c.products} product{c.products === 1 ? "" : "s"})</span>
                {coveredBy ? <span className="record-meta"> · included with {nameOf(coveredBy)}</span> : null}
              </label>
            );
          })}
          {error ? <p className="auth-message" role="alert">{error}</p> : null}
          <div className="response-actions">
            <button type="button" className="button button-small" disabled={busy || picked.length === 0} onClick={() => save(picked)}>
              {busy ? "Saving…" : "Save brands"}
            </button>
            {!usingDefault ? (
              <button type="button" className="button button-small button-secondary" disabled={busy} onClick={() => save(null)}>
                Use default ({defaultLabel})
              </button>
            ) : null}
            <button type="button" className="link-button" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </fieldset>
      ) : (
        <button type="button" className="button button-small button-secondary" onClick={start}>Choose brands</button>
      )}
    </div>
  );
}

function StaffList({ tenantId }: { tenantId: Id<"tenants"> }) {
  const staff = useQuery(api.staff.listStaff, { tenantId });
  const changeRole = useMutation(api.staff.changeRole);
  const setAccess = useMutation(api.staff.setAccess);
  const setManager = useMutation(api.staff.setManager);
  const setBrands = useMutation(api.staff.setBrands);
  const brandChoices = useQuery(api.staff.brandChoices, { tenantId });
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
              {person.brands && brandChoices ? (
                <BrandAccess
                  person={person}
                  manager={staff.find((m) => m.userId === person.managerUserId && m.role === "sales_manager") ?? null}
                  choices={brandChoices.brands}
                  defaultBrands={brandChoices.defaultBrands}
                  onSave={async (brands) => { await setBrands({ membershipId: person.membershipId, brands }); }}
                />
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
