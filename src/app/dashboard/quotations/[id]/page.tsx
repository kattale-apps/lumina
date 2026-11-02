"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import { fromMinor, money, STATUS_HELP, STATUS_LABELS, toMinor } from "../../quotes";
import { InstallmentCalculator, SalesOutcome } from "./SalesOutcome";

type View = NonNullable<ReturnType<typeof useQuery<typeof api.quotations.getQuotation>>>;

type Draft = {
  key: number;
  productId: Id<"products"> | null;
  supplierOfferId: Id<"supplierOffers"> | null;
  description: string;
  sku: string | null;
  quantity: string;
  price: string;
};
let nextKey = 1;

function Editor({ view, tenantId }: { view: View; tenantId: Id<"tenants"> }) {
  const supplierOffers = useQuery(api.suppliers.listSupplierOffers, { tenantId });
  const [supplierOfferToAdd, setSupplierOfferToAdd] = useState("");
  const revise = useMutation(api.quotations.reviseQuotation);
  const { shown, quotation } = view;
  const [lines, setLines] = useState<Draft[]>(() =>
    shown.lines.map((l) => ({
      key: nextKey++,
      productId: l.productId as Id<"products"> | null,
      supplierOfferId: l.supplierOfferId as Id<"supplierOffers"> | null,
      description: l.description,
      sku: l.sku,
      quantity: String(l.quantity),
      price: fromMinor(l.unitPriceMinor, shown.currency)
    }))
  );
  const [tax, setTax] = useState(String(shown.taxBps / 100));
  const [days, setDays] = useState(String(shown.validityDays));
  const [terms, setTerms] = useState(shown.customTerms);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (key: number, patch: Partial<Draft>) =>
    setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save() {
    setNotice(null);
    try {
      const { revision } = await revise({
        quotationId: quotation.id,
        expectedRevision: quotation.currentRevision,
        taxBps: Math.round(Number(tax) * 100),
        validityDays: Number(days),
        customTerms: terms,
        reason,
        lines: lines.map((l) =>
          l.productId
            ? { kind: "product" as const, productId: l.productId, quantity: Number(l.quantity), unitPriceMinor: toMinor(l.price, shown.currency) }
            : l.supplierOfferId
              ? { kind: "supplier_product" as const, supplierOfferId: l.supplierOfferId, quantity: Number(l.quantity), unitPriceMinor: toMinor(l.price, shown.currency) }
              : { kind: "service" as const, description: l.description, quantity: Number(l.quantity), unitPriceMinor: toMinor(l.price, shown.currency) }
        )
      });
      setNotice({ ok: true, text: `Saved as revision ${revision}. Any earlier approval no longer applies.` });
      setReason("");
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    }
  }

  return (
    <form
      className="panel-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>Edit lines and terms</h2>
      <p className="hint">Saving creates a new revision and clears earlier technical and commercial approvals.</p>
      {lines.map((l) => (
        <fieldset className="panel-form" key={l.key}>
          <legend>{l.sku ? `${l.description} (${l.sku})` : "Service"}</legend>
          {!l.productId && !l.supplierOfferId ? (
            <>
              <label htmlFor={`d-${l.key}`}>Description</label>
              <input id={`d-${l.key}`} maxLength={120} value={l.description} onChange={(e) => set(l.key, { description: e.target.value })} />
            </>
          ) : null}
          {l.supplierOfferId ? <p className="hint">Supplier source: {l.description} ({l.sku})</p> : null}
          <label htmlFor={`q-${l.key}`}>Quantity</label>
          <input id={`q-${l.key}`} inputMode="numeric" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value })} />
          <label htmlFor={`p-${l.key}`}>Unit price ({shown.currency})</label>
          <input id={`p-${l.key}`} inputMode="decimal" value={l.price} onChange={(e) => set(l.key, { price: e.target.value })} />
          <button type="button" className="button button-secondary button-small" onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>
            Remove
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="button button-secondary button-small"
        onClick={() =>
          setLines((all) => [...all, { key: nextKey++, productId: null, supplierOfferId: null, description: "", sku: null, quantity: "1", price: "0" }])
        }
      >
        Add a service line (installation, transport…)
      </button>
      <label htmlFor="supplier-offer-add">Supplier product</label>
      <select id="supplier-offer-add" value={supplierOfferToAdd} onChange={e => setSupplierOfferToAdd(e.target.value)}>
        <option value="">Choose supplier product…</option>
        {(supplierOffers ?? []).filter(o => o.currency === shown.currency).map(o => <option key={o.id} value={o.id}>{o.name} · {o.supplierName} · {o.availableQuantity} available</option>)}
      </select>
      <button type="button" className="button button-secondary button-small" disabled={!supplierOfferToAdd} onClick={() => {
        const offer = supplierOffers?.find(o => o.id === supplierOfferToAdd);
        if (!offer) return;
        setLines(all => [...all, { key: nextKey++, productId: null, supplierOfferId: offer.id as Id<"supplierOffers">, description: offer.name, sku: offer.sku, quantity: "1", price: fromMinor(offer.sellingPriceMinor, shown.currency) }]);
      }}>Add selected supplier product</button>
      {supplierOffers && supplierOffers.filter(o => o.currency === shown.currency).length === 0 ? <p className="hint">No supplier offers in this quotation currency.</p> : null}
      <label htmlFor="qe-tax">Tax (%)</label>
      <input id="qe-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
      <label htmlFor="qe-days">Valid for (days)</label>
      <input id="qe-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} />
      <label htmlFor="qe-terms">Special terms (a manager must approve these)</label>
      <textarea id="qe-terms" rows={2} maxLength={1000} value={terms} onChange={(e) => setTerms(e.target.value)} />
      <label htmlFor="qe-reason">Reason for the change</label>
      <input id="qe-reason" required maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
      <button className="button" type="submit">Save as new revision</button>
    </form>
  );
}

function TechnicalDecision({ view }: { view: View }) {
  const decide = useMutation(api.quotations.decideTechnical);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const run = async (outcome: "approved" | "revision_required" | "rejected") => {
    setError("");
    try {
      await decide({
        quotationId: view.quotation.id,
        revision: view.quotation.currentRevision,
        outcome,
        reason,
        checklist: view.checklist.map((c) => ({ key: c.key, confirmed: Boolean(checked[c.key]) }))
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section className="panel-form" aria-labelledby="td">
      <h2 id="td">Technical review</h2>
      {view.sizing.openReviews > 0 ? (
        <p className="auth-message">
          {view.sizing.openReviews} sizing check(s) still need a recorded resolution on the sizing page.
        </p>
      ) : null}
      {view.checklist.map((c) => (
        <label className="check-row" key={c.key}>
          <input type="checkbox" checked={Boolean(checked[c.key])} onChange={(e) => setChecked({ ...checked, [c.key]: e.target.checked })} />
          {c.label}
        </label>
      ))}
      <label htmlFor="td-reason">Reason (required to return or reject)</label>
      <input id="td-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <div className="record-actions">
        <button className="button" type="button" onClick={() => void run("approved")}>Approve</button>
        <button className="button button-secondary" type="button" onClick={() => void run("revision_required")}>Return for revision</button>
        <button className="button button-secondary" type="button" onClick={() => void run("rejected")}>Reject</button>
      </div>
    </section>
  );
}

function CommercialDecision({ view }: { view: View }) {
  const decide = useMutation(api.quotations.decideCommercial);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const run = async (outcome: "approved" | "rejected") => {
    setError("");
    try {
      await decide({ quotationId: view.quotation.id, revision: view.quotation.currentRevision, outcome, reason });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section className="panel-form" aria-labelledby="cd">
      <h2 id="cd">Commercial approval</h2>
      <p className="hint">Some prices are below the floor price, or special terms were added.</p>
      <label htmlFor="cd-reason">Reason</label>
      <input id="cd-reason" required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <div className="record-actions">
        <button className="button" type="button" onClick={() => void run("approved")}>Approve</button>
        <button className="button button-secondary" type="button" onClick={() => void run("rejected")}>Decline</button>
      </div>
    </section>
  );
}

function Actions({ view }: { view: View }) {
  const submit = useMutation(api.quotations.submitForReview);
  const start = useMutation(api.quotations.startReview);
  const issue = useMutation(api.quotations.issueQuotation);
  const withdraw = useMutation(api.quotations.withdrawQuotation);
  const pdf = useAction(api.quotations.generateIllustrativePdf);
  const [error, setError] = useState("");
  const [why, setWhy] = useState("");
  const id = view.quotation.id;
  const run = async (fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="workspace-section">
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <div className="record-actions">
        {view.can.edit ? (
          <button
            className="button button-secondary"
            type="button"
            onClick={() =>
              run(async () => {
                const { url } = await pdf({ quotationId: id });
                if (url) window.open(url, "_blank", "noopener");
              })
            }
          >
            Illustrative PDF
          </button>
        ) : null}
        {view.can.submit ? (
          <button className="button" type="button" onClick={() => run(() => submit({ quotationId: id }))}>
            Submit for technical review
          </button>
        ) : null}
        {view.can.startReview ? (
          <button className="button" type="button" onClick={() => run(() => start({ quotationId: id }))}>
            Start technical review
          </button>
        ) : null}
        {view.can.issue ? (
          <button className="button" type="button" onClick={() => run(() => issue({ quotationId: id }))}>
            Issue official quotation
          </button>
        ) : null}
      </div>
      {view.can.withdraw ? (
        <div className="inline-form">
          <input aria-label="Reason for withdrawing" placeholder="Reason for withdrawing" value={why} onChange={(e) => setWhy(e.target.value)} />
          <button className="button button-secondary button-small" type="button" onClick={() => run(() => withdraw({ quotationId: id, reason: why }))}>
            Withdraw
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Detail({ quotationId, role, tenantId }: { quotationId: Id<"quotations">; role: string; tenantId: Id<"tenants"> }) {
  const [revision, setRevision] = useState<number | undefined>();
  const view = useQuery(api.quotations.getQuotation, { quotationId, revision });
  if (!view) return <p className="muted">Loading quotation…</p>;
  const { quotation, shown } = view;
  const illustrative = ["draft", "illustrative"].includes(quotation.status);

  return (
    <>
      <p><Link href="/dashboard/quotations">← All quotations</Link></p>
      {illustrative ? (
        <p className="auth-message" role="note">
          <strong>UNVERIFIED — FOR ILLUSTRATION ONLY.</strong> Equipment, stock, final pricing and terms remain
          subject to company verification. This is not an offer.
        </p>
      ) : null}
      <h2>{quotation.officialNumber ?? "Quotation draft"} · {quotation.customerName}</h2>
      <p className="record-meta">{quotation.siteName}</p>
      <p>
        <span className={quotation.status === "officially_issued" ? "pill" : "pill pill-warn"}>{STATUS_LABELS[quotation.status]}</span>{" "}
        <span className="record-meta">{STATUS_HELP[quotation.status]}</span>
      </p>
      {quotation.validUntil ? <p className="record-meta">Valid until {new Date(quotation.validUntil).toLocaleDateString()}</p> : null}
      {view.sizing.stale ? (
        <p className="auth-message">The assessment changed after this was sized, so it cannot be approved or issued.</p>
      ) : null}

      <div className="filter-row">
        <label htmlFor="q-rev">Revision</label>
        <select id="q-rev" value={shown.revision} onChange={(e) => setRevision(Number(e.target.value))}>
          {view.revisions.map((r) => (
            <option key={r.revision} value={r.revision}>
              {r.revision} — {new Date(r.createdAt).toLocaleString()} {r.reason ? `— ${r.reason}` : ""}
            </option>
          ))}
        </select>
      </div>
      {!shown.isCurrent ? <p className="hint">You are viewing an earlier revision.</p> : null}

      <section className="pricing-box">
        <ul className="spec-list">
          {shown.lines.map((l, i) => (
            <li key={i}>
              {l.quantity} × {l.description}
              {l.sku ? ` (${l.sku})` : ""} — {money(l.unitPriceMinor, shown.currency)} each ={" "}
              {l.supplierNameSnapshot ? <span className="record-meta">Supplier: {l.supplierNameSnapshot} · </span> : null}
              <strong>{money(l.quantity * l.unitPriceMinor, shown.currency)}</strong>
              {l.unitPriceMinor < l.unitListMinor ? ` (list ${money(l.unitListMinor, shown.currency)})` : ""}
              {l.belowFloor ? <span className="pill pill-warn"> below floor price</span> : null}
            </li>
          ))}
        </ul>
        <p>
          Subtotal {money(shown.subtotalMinor, shown.currency)} · Tax ({shown.taxBps / 100}%){" "}
          {money(shown.taxMinor, shown.currency)} · <strong>Total {money(shown.totalMinor, shown.currency)}</strong>
        </p>
        <p className="hint">
          Valid for {shown.validityDays} days from issue. {shown.customTerms ? `Special terms: ${shown.customTerms}` : ""}
        </p>
        {shown.requiresCommercialApproval ? (
          <p className="hint">This revision needs a manager&apos;s commercial approval.</p>
        ) : null}
        {shown.illustrativePdfUrl ? (
          <p><a href={shown.illustrativePdfUrl} target="_blank" rel="noopener noreferrer">Illustrative PDF (unverified)</a></p>
        ) : null}
        {shown.officialPdfUrl ? (
          <p><a href={shown.officialPdfUrl} target="_blank" rel="noopener noreferrer">Official quotation PDF</a></p>
        ) : null}
      </section>

      {quotation.status === "officially_issued" ? (
        <>
          <SalesOutcome quotationId={quotationId} role={role} />
          <InstallmentCalculator totalMinor={shown.totalMinor} currency={shown.currency} />
        </>
      ) : null}

      {shown.isCurrent ? <Actions view={view} /> : null}
      {view.can.decideTechnical && shown.isCurrent ? <TechnicalDecision view={view} /> : null}
      {view.can.decideCommercial && shown.isCurrent ? <CommercialDecision view={view} /> : null}
      {view.can.edit && shown.isCurrent ? <Editor key={`${quotation.id}-${quotation.currentRevision}`} view={view} tenantId={tenantId} /> : null}

      {view.technicalReviews.length + view.commercialApprovals.length > 0 ? (
        <section className="workspace-section">
          <h2>Decisions on revision {shown.revision}</h2>
          <ul className="spec-list">
            {view.technicalReviews.map((r, i) => (
              <li key={`t${i}`}>
                Technical: <strong>{r.outcome.replace("_", " ")}</strong>
                {r.reason ? ` — ${r.reason}` : ""} ({new Date(r.createdAt).toLocaleString()})
              </li>
            ))}
            {view.commercialApprovals.map((r, i) => (
              <li key={`c${i}`}>
                Commercial: <strong>{r.outcome}</strong> — {r.reason} ({new Date(r.createdAt).toLocaleString()})
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export default function QuotationPage() {
  const params = useParams<{ id: string }>();
  return (
    <ConfiguredOnly>
      <CompanyPage title="Quotation" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {(company) => <Detail quotationId={params.id as Id<"quotations">} role={company.role} tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
