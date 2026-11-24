"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly } from "../workspace";

type Tab = "inquiries" | "checks" | "activity";
const when = (t: number) => new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/** "2 h 15 min" between two times. */
function took(from: number, to: number) {
  const min = Math.max(0, Math.round((to - from) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ${min % 60} min`;
  return `${Math.round(h / 24)} days`;
}

function Inquiries({ tenantId }: { tenantId: Id<"tenants"> }) {
  const [show, setShow] = useState<"all" | "answered" | "unanswered">("all");
  const data = useQuery(api.salesLog.inquiries, { tenantId, show });
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <>
      <p className="muted">
        {data.total} inquiries · <strong>{data.answered}</strong> answered · <strong>{data.total - data.answered}</strong> not answered yet
      </p>
      <div className="chip-row" role="radiogroup" aria-label="Show">
        {(["all", "unanswered", "answered"] as const).map((s) => (
          <button key={s} type="button" role="radio" aria-checked={show === s} className={`chip ${show === s ? "chip-on" : ""}`} onClick={() => setShow(s)}>
            {s === "all" ? "All" : s === "unanswered" ? "Not answered" : "Answered"}
          </button>
        ))}
      </div>
      <ul className="record-list">
        {data.rows.map((r) => (
          <li key={`${r.source}-${r.id}`} className={`record-card log-row ${r.answered ? "" : "log-unanswered"}`}>
            <div>
              <span className="record-title">
                <Link href={r.link}><u>{r.kind}</u></Link> · {r.name} · {r.phone}
              </span>
              <span className="record-meta">{when(r.createdAt)} · {r.location}</span>
              <span className="record-meta">{r.summary}</span>
              <span className="pill-row">
                {r.answered
                  ? <span className="pill pill-ok">{r.answeredHow} by {r.answeredBy ?? "staff"} · {took(r.createdAt, r.answeredAt!)}</span>
                  : <span className="pill pill-bad">Not answered · waiting {took(r.createdAt, Date.now())}</span>}
                {r.routedTo ? <span className="pill pill-info">WhatsApp to {r.routedTo}</span> : null}
                {r.whatsappOpenedAt ? <span className="pill">Customer opened WhatsApp {when(r.whatsappOpenedAt)}</span> : r.routedTo ? <span className="pill">WhatsApp not opened</span> : null}
                {r.assignedTo ? <span className="pill">Assigned: {r.assignedTo}</span> : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {data.rows.length === 0 ? <p className="muted">Nothing here.</p> : null}
    </>
  );
}

function Checks({ tenantId }: { tenantId: Id<"tenants"> }) {
  const rows = useQuery(api.salesLog.checks, { tenantId });
  if (!rows) return <p className="muted">Loading…</p>;
  const requested = rows.filter((r) => r.requestId).length;
  const KIND = { energy: "Energy check", upgrade: "Upgrade check", budget: "Budget check" } as const;
  return (
    <>
      <p className="muted">{rows.length} checks · {requested} led to a request · {rows.length - requested} did not</p>
      <ul className="record-list">
        {rows.map((c) => (
          <li key={c.id} className="record-card log-row">
            <div>
              <span className="record-title">{KIND[c.kind]}{c.by ? ` · by ${c.by}` : ""}</span>
              <span className="record-meta">{when(c.createdAt)}</span>
              <span className="record-meta">{c.summary}</span>
              <span className="pill-row">
                {c.requestId
                  ? <Link className="pill pill-ok" href={`/dashboard/leads/${c.requestId}`}>Request sent: open it</Link>
                  : <span className="pill">No request sent</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {rows.length === 0 ? <p className="muted">No checks recorded yet.</p> : null}
    </>
  );
}

function Activity({ tenantId }: { tenantId: Id<"tenants"> }) {
  const rows = useQuery(api.salesLog.activity, { tenantId });
  if (!rows) return <p className="muted">Loading…</p>;
  return (
    <ul className="record-list">
      {rows.map((e) => (
        <li key={e.id} className="record-card log-row">
          <div>
            <span className="record-title">{e.summary}</span>
            <span className="record-meta">{when(e.at)} · {e.by} · <code>{e.action}</code></span>
          </div>
        </li>
      ))}
      {rows.length === 0 ? <p className="muted">No sales activity yet.</p> : null}
    </ul>
  );
}

function SalesLog({ tenantId }: { tenantId: Id<"tenants"> }) {
  const [tab, setTab] = useState<Tab>("inquiries");
  return (
    <>
      <p className="muted">Every inquiry and check, answered or not, and every sales action, with dates and times.</p>
      <div className="tab-row" role="tablist">
        {([["inquiries", "Inquiries"], ["checks", "Checks"], ["activity", "Sales activity"]] as [Tab, string][]).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`chip ${tab === key ? "chip-on" : ""}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <section className="workspace-section">
        {tab === "inquiries" ? <Inquiries tenantId={tenantId} /> : tab === "checks" ? <Checks tenantId={tenantId} /> : <Activity tenantId={tenantId} />}
      </section>
    </>
  );
}

export default function SalesLogPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Sales log" allowedRoles={["super_admin"]}>
        {(company) => <SalesLog tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
