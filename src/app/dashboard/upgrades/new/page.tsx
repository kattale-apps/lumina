"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import type { ExistingSystem, UpgradeNeeds } from "../../../estimate/upgrade/describe";
import { blankUpgradeForm, toPayload, UpgradeForm } from "../../../estimate/upgrade/UpgradeForm";
import { UpgradeReport, type Report } from "../../../estimate/upgrade/UpgradeReport";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";

function SaveToCustomer({
  tenantId, checked
}: {
  tenantId: Id<"tenants">;
  checked: { system: ExistingSystem; needs: UpgradeNeeds };
}) {
  const router = useRouter();
  const customers = useQuery(api.customers.listCustomers, { tenantId });
  const save = useMutation(api.upgrades.saveStudy);
  const [customerId, setCustomerId] = useState<Id<"customers"> | "">("");
  const customer = useQuery(api.customers.getCustomer, customerId ? { customerId } : "skip");
  const [siteId, setSiteId] = useState<Id<"customerSites"> | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!customers) return null;
  if (!customers.canWrite) {
    return <p className="hint">Your role can run upgrade checks but not save them to a customer.</p>;
  }
  const active = customers.customers.filter((c) => c.status === "active");
  const sites = (customer?.sites ?? []).filter((s) => s.status === "active");
  // With a single site there is nothing to choose.
  const chosenSite = siteId || (sites.length === 1 ? sites[0].id : "");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!customerId || !chosenSite) {
      setError("Choose the customer and the site this system is at.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { studyId } = await save({ customerId, siteId: chosenSite, system: checked.system, needs: checked.needs });
      router.push(`/dashboard/upgrades/${studyId}`);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Save this study to a customer</h2>
      <p className="hint">
        A saved study can be turned into a quotation and downloaded as a report. To change the figures later, run a new check.
      </p>
      {active.length === 0 ? (
        <p className="muted">
          There are no customers yet. <Link href="/dashboard/customers"><u>Add the customer and their site</u></Link>, then run the check again.
        </p>
      ) : (
        <>
          <label htmlFor="us-customer">Customer</label>
          <select id="us-customer" value={customerId} onChange={(e) => { setCustomerId(e.target.value as Id<"customers"> | ""); setSiteId(""); }}>
            <option value="">Choose a customer…</option>
            {active.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
          </select>
          {customerId && customer && sites.length === 0 ? (
            <p className="muted">
              This customer has no site yet. <Link href={`/dashboard/customers/${customerId}`}><u>Add the site</u></Link> first.
            </p>
          ) : null}
          {sites.length > 1 ? (
            <>
              <label htmlFor="us-site">Site</label>
              <select id="us-site" value={siteId} onChange={(e) => setSiteId(e.target.value as Id<"customerSites"> | "")}>
                <option value="">Choose a site…</option>
                {sites.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.address}</option>)}
              </select>
            </>
          ) : null}
          {error ? <p className="auth-message" role="alert">{error}</p> : null}
          <button className="button" type="submit" disabled={busy || !customerId || !chosenSite}>{busy ? "Saving…" : "Save study"}</button>
        </>
      )}
    </form>
  );
}

function NewCheck({ tenantId }: { tenantId: Id<"tenants"> }) {
  const convex = useConvex();
  const [form, setForm] = useState(blankUpgradeForm);
  const [checked, setChecked] = useState<{ system: ExistingSystem; needs: UpgradeNeeds; report: Report } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function calculate(event: FormEvent) {
    event.preventDefault();
    const payload = toPayload(form);
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const report = await convex.query(api.upgrades.simulate, { tenantId, system: payload.system, needs: payload.needs });
      setChecked({ system: payload.system, needs: payload.needs, report });
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setChecked(null);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">
        Read the figures off the nameplates. Leave empty anything you cannot find: that part is then marked for a
        technician instead of being guessed. This needs a connection, because it checks the live catalogue.
      </p>
      <form className="panel-form estimate-form" onSubmit={calculate}>
        <UpgradeForm state={form} setState={setForm} audience="staff" />
        {error ? <p className="auth-message" role="alert">{error}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy ? "Working it out…" : checked ? "Run the check again" : "Run the check"}</button>
      </form>

      {checked ? (
        <section id="results" className="estimate-results" aria-live="polite">
          <h2>Upgrade report</h2>
          <UpgradeReport report={checked.report} />
          {checked.report.blockers.length === 0 ? <SaveToCustomer tenantId={tenantId} checked={checked} /> : null}
        </section>
      ) : null}
    </>
  );
}

export default function NewUpgradePage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="New upgrade check" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <NewCheck tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
