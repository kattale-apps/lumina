"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { ItemPicker, type PickerProduct } from "./ItemPicker";
import { savePdf } from "../../../lib/savePdf";
import { shrinkImage } from "../../../lib/shrinkImage";
import { buildSalesDocPdf, formatMoney } from "../../../lib/salesDocPdf";

type Kind = "proforma" | "receipt";
type Setup = FunctionReturnType<typeof api.salesDocuments.formSetup>;
type Doc = FunctionReturnType<typeof api.salesDocuments.getDocument>;
type Line = { key: string; description: string; quantity: string; unitPrice: string; productId?: string };

const KIND_LABEL: Record<Kind, string> = { proforma: "Proforma invoice", receipt: "Receipt" };
const PAYMENT_METHODS = ["Cash", "Mobile money", "Bank transfer", "Cheque"];
const blankLine = (): Line => ({ key: Math.random().toString(36).slice(2), description: "", quantity: "1", unitPrice: "" });
const digits = (text: string) => Number(text.replace(/[^\d]/g, "")) || 0;
const withCommas = (text: string) => (digits(text) ? digits(text).toLocaleString("en-US") : "");

/** Draws the PDF for a stored document and saves it (download, share sheet or link, on any device). */
async function downloadDocument(doc: Doc, setup: Setup) {
  const bytes = await buildSalesDocPdf({
    kind: doc.kind,
    number: doc.number,
    sellerName: doc.sellerName,
    sellerPhone: setup.contactPhone,
    sellerEmail: setup.contactEmail,
    buyer: doc.buyer,
    items: doc.items,
    currency: doc.currency,
    exponent: doc.exponent,
    totalMinor: doc.totalMinor,
    payments: doc.proofs.filter((p) => p.amountMinor !== null).map((p) => ({ amountMinor: p.amountMinor!, paidAt: p.paidAt })),
    paymentMethod: doc.paymentMethod,
    notes: doc.notes,
    createdAt: doc.createdAt,
    preparedBy: doc.createdBy
  });
  const safeName = doc.buyer.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer";
  await savePdf(bytes, `${doc.number.toLowerCase()}-${safeName}.pdf`, `${KIND_LABEL[doc.kind]} ${doc.number}`);
}

/** Upload one payment proof photo and attach it to the document. */
function useAddProof() {
  const uploadUrl = useMutation(api.salesDocuments.proofUploadUrl);
  const addProof = useMutation(api.salesDocuments.addProof);
  return async (documentId: Id<"salesDocuments">, file: File, extra: { amount?: number; paidAt?: number; note?: string }) => {
    const blob = await shrinkImage(file);
    const url = await uploadUrl({ documentId });
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type || "image/jpeg" }, body: blob });
    if (!res.ok) throw new Error("The photo did not upload. Please try again.");
    const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
    await addProof({ documentId, storageId, ...extra });
  };
}

/** Photo, amount and date of one payment. Camera or gallery: no "capture", so phones offer both. */
function ProofPicker({ onFile, file, amount, setAmount, paidOn, setPaidOn, note, setNote, idPrefix }: {
  onFile: (f: File | null) => void; file: File | null;
  amount: string; setAmount: (v: string) => void; paidOn: string; setPaidOn: (v: string) => void;
  note: string; setNote: (v: string) => void; idPrefix: string;
}) {
  return (
    <div className="proof-picker">
      <label className="nameplate-add">
        <input type="file" accept="image/*" className="visually-hidden" onChange={(e) => { onFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
        <span aria-hidden="true">📷</span> {file ? `Photo chosen: ${file.name}` : "Add payment proof photo (camera or gallery)"}
      </label>
      {file ? (
        <div className="stock-edit-row">
          <label htmlFor={`${idPrefix}-amt`}>Amount paid</label>
          <input id={`${idPrefix}-amt`} className="proof-amount" inputMode="numeric" placeholder="e.g. 500,000" value={amount} onChange={(e) => setAmount(withCommas(e.target.value))} />
          <label htmlFor={`${idPrefix}-date`}>Paid on</label>
          <input id={`${idPrefix}-date`} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          <input aria-label="Note" placeholder="Note, e.g. MTN MoMo ref" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="button" className="button button-small button-secondary" onClick={() => onFile(null)}>Remove photo</button>
        </div>
      ) : null}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const dateToMs = (d: string) => (d ? new Date(`${d}T12:00:00`).getTime() : undefined);

function NewDocument({ tenantId, setup, onCreated }: { tenantId: Id<"tenants">; setup: Setup; onCreated: (id: Id<"salesDocuments">) => void }) {
  const convex = useConvex();
  const create = useMutation(api.salesDocuments.createDocument);
  const addProof = useAddProof();
  const [kind, setKind] = useState<Kind>("proforma");
  const [seller, setSeller] = useState(setup.companyName);
  const [buyer, setBuyer] = useState({ name: "", location: "", contact: "" });
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState("Mobile money");
  const [proof, setProof] = useState<File | null>(null);
  const [proofAmount, setProofAmount] = useState("");
  const [proofDate, setProofDate] = useState(today());
  const [proofNote, setProofNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const total = lines.reduce((s, l) => s + digits(l.unitPrice) * (Number(l.quantity) || 0), 0);
  const set = (key: string, patch: Partial<Line>) => setLines((all) => all.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Product names repeat across brands, so a name the catalogue has more than once is
  // printed with its brand, letting the buyer see exactly which one is meant.
  const repeatedNames = useMemo(() => {
    const seen = new Map<string, number>();
    for (const p of setup.products) seen.set(p.name.toLowerCase(), (seen.get(p.name.toLowerCase()) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([name]) => name));
  }, [setup.products]);

  // Choosing a catalogue product fills in today's list price; it can still be changed.
  function pickProduct(key: string, product: PickerProduct) {
    const description = repeatedNames.has(product.name.toLowerCase()) && product.brand ? `${product.name} (${product.brand})` : product.name;
    set(key, {
      description,
      productId: product.id,
      unitPrice: product.listMinor !== null ? (product.listMinor / 10 ** setup.exponent).toLocaleString("en-US") : ""
    });
  }

  // Typing over a chosen product turns the line back into a free-text item.
  function typeItem(key: string, text: string) {
    set(key, { description: text, productId: undefined });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setDone("");
    try {
      const filled = lines.filter((l) => l.description.trim());
      const { documentId, number } = await create({
        tenantId,
        kind,
        sellerName: seller,
        buyer,
        items: filled.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: digits(l.unitPrice), productId: l.productId as Id<"products"> | undefined })),
        notes: notes || undefined,
        paymentMethod: kind === "receipt" ? method : undefined
      });
      if (proof) await addProof(documentId, proof, { amount: proofAmount ? digits(proofAmount) : undefined, paidAt: dateToMs(proofDate), note: proofNote || undefined });
      const doc = await convex.query(api.salesDocuments.getDocument, { documentId });
      await downloadDocument(doc, setup);
      setDone(`${KIND_LABEL[kind]} ${number} saved and downloaded.`);
      setBuyer({ name: "", location: "", contact: "" });
      setLines([blankLine()]);
      setNotes("");
      setProof(null);
      setProofAmount("");
      setProofNote("");
      onCreated(documentId);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form invoice-form" onSubmit={submit}>
      <h2>New proforma invoice or receipt</h2>
      <div className="choice-row" role="radiogroup" aria-label="Document type">
        {(["proforma", "receipt"] as Kind[]).map((k) => (
          <button type="button" key={k} role="radio" aria-checked={kind === k} className={`choice ${kind === k ? "choice-on" : ""}`} onClick={() => setKind(k)}>
            <strong>{k === "proforma" ? "🧾 Proforma invoice" : "✅ Receipt"}</strong>
            <span>{k === "proforma" ? "Prices offered, before payment" : "Payment received"}</span>
          </button>
        ))}
      </div>

      <label htmlFor="inv-seller">Company name (on the document)</label>
      <input id="inv-seller" required maxLength={120} value={seller} onChange={(e) => setSeller(e.target.value)} />

      <h3>Buyer</h3>
      <label htmlFor="inv-bname">Name</label>
      <input id="inv-bname" required maxLength={120} autoComplete="off" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} />
      <label htmlFor="inv-bloc">Location</label>
      <input id="inv-bloc" required maxLength={200} value={buyer.location} onChange={(e) => setBuyer({ ...buyer, location: e.target.value })} />
      <label htmlFor="inv-bcontact">Contact (phone)</label>
      <input id="inv-bcontact" required type="tel" maxLength={120} placeholder="+256 700 000000" value={buyer.contact} onChange={(e) => setBuyer({ ...buyer, contact: e.target.value })} />

      <h3>Items</h3>
      <div className="invoice-lines">
        {lines.map((l, i) => (
          <div className="invoice-line" key={l.key}>
            <ItemPicker
              id={`inv-item-${l.key}`}
              label={`Item ${i + 1}`}
              value={l.description}
              productId={l.productId}
              products={setup.products}
              formatPrice={(minor) => formatMoney(minor, setup.exponent, setup.currency)}
              onType={(text) => typeItem(l.key, text)}
              onPick={(product) => pickProduct(l.key, product)}
            />
            <input aria-label={`Quantity ${i + 1}`} className="invoice-qty" inputMode="numeric" value={l.quantity} onChange={(e) => set(l.key, { quantity: e.target.value.replace(/[^\d]/g, "") })} />
            <input aria-label={`Unit price ${i + 1}`} className="invoice-price" inputMode="numeric" placeholder={`Price (${setup.currency})`} value={l.unitPrice} onChange={(e) => set(l.key, { unitPrice: withCommas(e.target.value) })} />
            <span className="invoice-amount">Line total: {formatMoney(digits(l.unitPrice) * (Number(l.quantity) || 0) * 10 ** setup.exponent, setup.exponent, setup.currency)}</span>
            {lines.length > 1 ? <button type="button" className="link-button" aria-label={`Remove item ${i + 1}`} onClick={() => setLines((all) => all.filter((x) => x.key !== l.key))}>✕</button> : null}
          </div>
        ))}
      </div>
      <button type="button" className="button button-small button-secondary" onClick={() => setLines((all) => [...all, blankLine()])}>＋ Add item</button>
      <p className="invoice-total">Total: <strong>{formatMoney(total * 10 ** setup.exponent, setup.exponent, setup.currency)}</strong></p>

      {kind === "receipt" ? (
        <>
          <label htmlFor="inv-method">Payment method</label>
          <select id="inv-method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {PAYMENT_METHODS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </>
      ) : null}
      <label htmlFor="inv-notes">Notes (optional)</label>
      <input id="inv-notes" maxLength={500} placeholder="e.g. Delivery included; valid for 14 days" value={notes} onChange={(e) => setNotes(e.target.value)} />

      <h3>Payment proof (optional)</h3>
      <p className="hint">Attach a photo of the mobile money message or bank slip. More can be added later, one for each instalment.</p>
      <ProofPicker idPrefix="new-proof" file={proof} onFile={setProof} amount={proofAmount} setAmount={setProofAmount} paidOn={proofDate} setPaidOn={setProofDate} note={proofNote} setNote={setProofNote} />

      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      {done ? <p className="form-success" role="status">{done}</p> : null}
      <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : `Save and download ${KIND_LABEL[kind].toLowerCase()} PDF`}</button>
    </form>
  );
}

/** One saved document: download again, and its payment proofs (add more for instalments). */
function DocumentCard({ doc, setup, open, onToggle }: { doc: Doc; setup: Setup; open: boolean; onToggle: () => void }) {
  const addProof = useAddProof();
  const removeProof = useMutation(api.salesDocuments.removeProof);
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const money = (m: number) => formatMoney(m, doc.exponent, doc.currency);

  async function run(label: string, action: () => Promise<string>) {
    setBusy(label);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await action() });
    } catch (e) {
      setMsg({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy("");
    }
  }

  return (
    <li className="record-card invoice-card" id={`doc-${doc.id}`}>
      <div className="field-head">
        <div>
          <span className="record-title">{doc.number} · {doc.buyer.name}</span>
          <span className="record-meta">
            {doc.kind === "proforma" ? "Proforma invoice" : "Receipt"} · {new Date(doc.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · by {doc.createdBy}
          </span>
          <span className="record-meta">{doc.buyer.contact} · {doc.buyer.location}</span>
        </div>
        <div className="price-block">
          <span className="price">{money(doc.totalMinor)}</span>
          {doc.paidMinor > 0 ? <span className="record-meta">Paid {money(doc.paidMinor)} · balance {money(Math.max(doc.totalMinor - doc.paidMinor, 0))}</span> : null}
          <div className="stock-edit-row">
            <button type="button" className="button button-small" disabled={busy !== ""} onClick={() => run("pdf", async () => { await downloadDocument(doc, setup); return "PDF ready."; })}>
              {busy === "pdf" ? "Preparing…" : "Download PDF"}
            </button>
            <button type="button" className="button button-small button-secondary" aria-expanded={open} onClick={onToggle}>
              {open ? "Close" : `Payments (${doc.proofs.length})`}
            </button>
          </div>
        </div>
      </div>
      {open ? (
        <div className="stock-editor">
          <ul className="component-list">
            {doc.items.map((it, i) => (
              <li key={i}><strong>{it.quantity} × {it.description}</strong><span>{money(it.unitPriceMinor)} each · {money(it.unitPriceMinor * it.quantity)}</span></li>
            ))}
          </ul>
          <h3>Payment proofs</h3>
          {doc.proofs.length === 0 ? <p className="hint">None yet.</p> : (
            <div className="proof-grid">
              {doc.proofs.map((p) => (
                <figure key={p.id}>
                  {p.url ? (
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={`Payment proof for ${doc.number}`} />
                    </a>
                  ) : null}
                  <figcaption>
                    {p.amountMinor !== null ? <strong>{money(p.amountMinor)}</strong> : "Amount not given"}
                    {p.paidAt ? ` · ${new Date(p.paidAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}` : ""}
                    {p.note ? <><br />{p.note}</> : null}
                    <br /><small>Added by {p.addedBy}, {new Date(p.createdAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</small>
                    <br />
                    <button type="button" className="link-button" disabled={busy !== ""} onClick={() => run("rm", async () => { await removeProof({ proofId: p.id }); return "Proof removed."; })}>Remove</button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          <ProofPicker idPrefix={`proof-${doc.id}`} file={file} onFile={setFile} amount={amount} setAmount={setAmount} paidOn={paidOn} setPaidOn={setPaidOn} note={note} setNote={setNote} />
          {file ? (
            <button
              type="button"
              className="button button-small"
              disabled={busy !== ""}
              onClick={() =>
                run("add", async () => {
                  await addProof(doc.id, file, { amount: amount ? digits(amount) : undefined, paidAt: dateToMs(paidOn), note: note || undefined });
                  setFile(null);
                  setAmount("");
                  setNote("");
                  return "Payment proof attached.";
                })
              }
            >
              {busy === "add" ? "Uploading…" : "Attach payment proof"}
            </button>
          ) : null}
          {msg ? <p className={msg.ok ? "form-success" : "auth-message"} role="status">{msg.text}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function Invoices({ tenantId }: { tenantId: Id<"tenants"> }) {
  const setup = useQuery(api.salesDocuments.formSetup, { tenantId });
  const docs = useQuery(api.salesDocuments.listDocuments, { tenantId });
  const params = useSearchParams();
  const [open, setOpen] = useState<string | null>(params.get("doc"));
  const [search, setSearch] = useState("");

  // Opened from a record book: scroll to that document.
  useEffect(() => {
    const id = params.get("doc");
    if (id && docs) setTimeout(() => document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [params, docs]);

  if (!setup || !docs) return <p className="muted">Loading…</p>;
  const term = search.trim().toLowerCase();
  const shown = docs.filter((d) => !term || `${d.number} ${d.buyer.name} ${d.buyer.contact}`.toLowerCase().includes(term));
  return (
    <>
      <NewDocument tenantId={tenantId} setup={setup} onCreated={(id) => setOpen(id)} />
      <section className="workspace-section" aria-labelledby="docs-heading">
        <h2 id="docs-heading">Saved invoices and receipts ({docs.length})</h2>
        <div className="filter-row">
          <label htmlFor="docs-search">Search</label>
          <input id="docs-search" type="search" placeholder="Number, buyer or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {shown.length === 0 ? <p className="muted">{docs.length ? "No documents match." : "None yet."}</p> : (
          <ul className="record-list">
            {shown.map((d) => <DocumentCard key={d.id} doc={d} setup={setup} open={open === d.id} onToggle={() => setOpen(open === d.id ? null : d.id)} />)}
          </ul>
        )}
      </section>
    </>
  );
}

export default function InvoicesPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Invoices & receipts" allowedRoles={["super_admin", "sales_manager", "sales_agent"]}>
        {(company) => (
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <Invoices tenantId={company.tenantId} />
          </Suspense>
        )}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
