"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import { CUSTOMER_TYPES, GRID_LABELS, type CustomerType, type GridAvailability } from "../../crm";

type Detail = NonNullable<ReturnType<typeof useQuery<typeof api.customers.getCustomer>>>;

function EditCustomer({ detail }: { detail: Detail }) {
  const update = useMutation(api.customers.updateCustomer);
  const { customer } = detail;
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email);
  const [type, setType] = useState<CustomerType>(customer.type);
  const [notes, setNotes] = useState(customer.notes);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(status: "active" | "archived") {
    setNotice(null);
    try {
      await update({ customerId: customer.id, name, phone, email, type, notes, status });
      setNotice({ ok: true, text: "Saved." });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    }
  }

  return (
    <form
      className="panel-form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void save(customer.status);
      }}
    >
      <h2>Customer details</h2>
      <label htmlFor="cd-name">Name</label>
      <input id="cd-name" required maxLength={120} disabled={!detail.canWrite} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="cd-phone">Phone</label>
      <input id="cd-phone" required type="tel" disabled={!detail.canWrite} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="cd-email">Email</label>
      <input id="cd-email" type="email" disabled={!detail.canWrite} value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="cd-type">Customer type</label>
      <select id="cd-type" disabled={!detail.canWrite} value={type} onChange={(e) => setType(e.target.value as CustomerType)}>
        {CUSTOMER_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <label htmlFor="cd-notes">Notes</label>
      <textarea id="cd-notes" rows={3} maxLength={1000} disabled={!detail.canWrite} value={notes} onChange={(e) => setNotes(e.target.value)} />
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p>
      ) : null}
      {detail.canWrite ? (
        <div className="record-actions">
          <button className="button" type="submit">Save changes</button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void save(customer.status === "active" ? "archived" : "active")}
          >
            {customer.status === "active" ? "Archive customer" : "Restore customer"}
          </button>
        </div>
      ) : null}
    </form>
  );
}

function AddSite({ customerId }: { customerId: Id<"customers"> }) {
  const create = useMutation(api.customers.createSite);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [region, setRegion] = useState("");
  const [grid, setGrid] = useState<GridAvailability>("none");
  const [existing, setExisting] = useState("");
  const [consent, setConsent] = useState(false);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    const hasGps = consent && lat.trim() !== "" && lng.trim() !== "";
    try {
      await create({
        customerId,
        name,
        address,
        region,
        gridAvailability: grid,
        existingSystem: existing,
        gpsConsent: consent,
        gps: hasGps ? { lat: Number(lat), lng: Number(lng) } : undefined
      });
      setNotice({ ok: true, text: "Site added." });
      setName("");
      setAddress("");
      setExisting("");
      setLat("");
      setLng("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Add an installation site</h2>
      <label htmlFor="st-name">Site name</label>
      <input id="st-name" required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="st-address">Address</label>
      <input id="st-address" required maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
      <label htmlFor="st-region">Region</label>
      <input id="st-region" required maxLength={80} value={region} onChange={(e) => setRegion(e.target.value)} />
      <label htmlFor="st-grid">Grid availability</label>
      <select id="st-grid" value={grid} onChange={(e) => setGrid(e.target.value as GridAvailability)}>
        {(Object.keys(GRID_LABELS) as GridAvailability[]).map((g) => (
          <option key={g} value={g}>{GRID_LABELS[g]}</option>
        ))}
      </select>
      <label htmlFor="st-existing">Existing power system (optional)</label>
      <input id="st-existing" maxLength={500} placeholder="e.g. 2 kVA petrol generator" value={existing} onChange={(e) => setExisting(e.target.value)} />
      <label className="check-row">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        The customer consents to recording this site&apos;s GPS location
      </label>
      {consent ? (
        <>
          <label htmlFor="st-lat">Latitude</label>
          <input id="st-lat" inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} />
          <label htmlFor="st-lng">Longitude</label>
          <input id="st-lng" inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} />
        </>
      ) : null}
      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p>
      ) : null}
      <button className="button" type="submit">Add site</button>
    </form>
  );
}

function Sites({ detail }: { detail: Detail }) {
  const router = useRouter();
  const createAssessment = useMutation(api.assessments.createAssessment);
  const updateSite = useMutation(api.customers.updateSite);
  const [error, setError] = useState("");

  async function start(siteId: Id<"customerSites">) {
    setError("");
    try {
      const { assessmentId } = await createAssessment({ customerId: detail.customer.id, siteId });
      router.push(`/dashboard/assessments/${assessmentId}`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function toggle(site: Detail["sites"][number]) {
    setError("");
    try {
      await updateSite({
        siteId: site.id,
        name: site.name,
        address: site.address,
        region: site.region,
        gps: site.gps ?? undefined,
        gpsConsent: site.gpsConsent,
        gridAvailability: site.gridAvailability,
        existingSystem: site.existingSystem,
        status: site.status === "active" ? "archived" : "active"
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <section aria-labelledby="sites-heading" className="workspace-section">
      <h2 id="sites-heading">Sites ({detail.sites.length})</h2>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {detail.sites.length === 0 ? (
        <p className="muted">No sites yet. Add one to start an assessment.</p>
      ) : (
        <ul className="record-list">
          {detail.sites.map((site) => (
            <li className="record-card" key={site.id}>
              <div>
                <span className="record-title">{site.name}</span>
                <span className="record-meta">{site.address}, {site.region}</span>
                <span className="record-meta">{GRID_LABELS[site.gridAvailability]}</span>
                {site.existingSystem ? <span className="record-meta">Existing: {site.existingSystem}</span> : null}
                {site.gps ? <span className="record-meta">GPS {site.gps.lat}, {site.gps.lng}</span> : null}
                {site.status === "archived" ? <span className="pill pill-warn">archived</span> : null}
              </div>
              {detail.canWrite ? (
                <div className="record-actions">
                  {site.status === "active" && detail.customer.status === "active" ? (
                    <button type="button" className="button button-small" onClick={() => void start(site.id)}>
                      Start assessment
                    </button>
                  ) : null}
                  <button type="button" className="button button-secondary button-small" onClick={() => void toggle(site)}>
                    {site.status === "active" ? "Archive" : "Restore"}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {detail.canWrite && detail.customer.status === "active" ? <AddSite customerId={detail.customer.id} /> : null}
    </section>
  );
}

function CustomerDetail({ customerId }: { customerId: Id<"customers"> }) {
  const detail = useQuery(api.customers.getCustomer, { customerId });
  if (!detail) return <p className="muted">Loading customer…</p>;
  return (
    <>
      <p><Link href="/dashboard/customers">← All customers</Link></p>
      <EditCustomer key={detail.customer.status + detail.customer.name} detail={detail} />
      <Sites detail={detail} />
    </>
  );
}

export default function CustomerPage() {
  const params = useParams<{ id: string }>();
  return (
    <ConfiguredOnly>
      <CompanyPage title="Customer" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {() => <CustomerDetail customerId={params.id as Id<"customers">} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
