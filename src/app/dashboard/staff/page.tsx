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
      {value === "super_admin" ? <option value="super_admin" disabled>{ROLE_LABELS.super_admin}</option> : null}
      {ROLE_OPTIONS.filter((role) => role !== "super_admin").map((role) => (
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


function InviteStaff({tenantId}:{tenantId:Id<"tenants">}){
 const invite=useMutation(api.staff.inviteStaff);
 const [fullName,setFullName]=useState("");const [email,setEmail]=useState("");
 const [phone,setPhone]=useState("");const [jobTitle,setJobTitle]=useState("");
 const [role,setRole]=useState<Role>("sales_agent");const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 async function submit(event:FormEvent){event.preventDefault();setBusy(true);setNotice("");
  try{await invite({tenantId,fullName,email,phone,jobTitle,role});setNotice("Invitation recorded for "+email+". Ask the employee to register using this exact email, then grant access from the staff list.");setFullName("");setEmail("");setPhone("");setJobTitle("");}
  catch(e){setNotice(errorMessage(e));}finally{setBusy(false);}
 }
 return <form className="panel-form" onSubmit={submit}>
  <h2>Invite a staff member</h2>
  <p className="hint">Record the employee before onboarding. They must register with the same email address. A superadmin then activates their company access.</p>
  <label htmlFor="invite-name">Full name</label><input id="invite-name" required value={fullName} onChange={e=>setFullName(e.target.value)}/>
  <label htmlFor="invite-email">Work email</label><input id="invite-email" type="email" required value={email} onChange={e=>setEmail(e.target.value)}/>
  <label htmlFor="invite-phone">Phone</label><input id="invite-phone" required value={phone} onChange={e=>setPhone(e.target.value)}/>
  <label htmlFor="invite-title">Job title</label><input id="invite-title" required value={jobTitle} onChange={e=>setJobTitle(e.target.value)}/>
  <label htmlFor="invite-role">Role</label><RoleSelect id="invite-role" value={role} onChange={setRole}/>
  {notice?<p className="form-success" role="status">{notice}</p>:null}
  <button className="button" type="submit" disabled={busy}>{busy?"Saving…":"Create invitation"}</button>
 </form>;
}

function InvitationList({tenantId}:{tenantId:Id<"tenants">}){
 const rows=useQuery(api.staff.listInvitations,{tenantId});
 const revoke=useMutation(api.staff.revokeInvitation);
 if(!rows)return null;
 return <section className="workspace-section"><h2>Invitations ({rows.length})</h2>
 {rows.length===0?<p className="muted">No invitations yet.</p>:<ul className="record-list">{rows.map(i=><li className="record-card" key={i.id}>
 <div><span className="record-title">{i.fullName}</span><span className="record-meta">{i.email} · {i.phone} · {i.jobTitle}</span><span className="record-meta">{ROLE_LABELS[i.role]} · {i.status} · expires {new Date(i.expiresAt).toLocaleDateString()}</span></div>
 {i.status==="pending"?<button className="button button-secondary button-small" type="button" onClick={()=>void revoke({invitationId:i.id})}>Revoke</button>:null}
 </li>)}</ul>}
 </section>;
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
            <InviteStaff tenantId={company.tenantId} />
            <InvitationList tenantId={company.tenantId} />
            <AddStaff tenantId={company.tenantId} />
            <StaffList tenantId={company.tenantId} />
          </>
        )}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
