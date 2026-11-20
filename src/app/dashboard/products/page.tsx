"use client";

import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { Pager, pageFor } from "../../../components/Pager";
import { SearchSuggest } from "../../../components/SearchSuggest";
import { countInto, matchesWords, searchWords, type Suggestion } from "@/lib/search";

type Categories = NonNullable<ReturnType<typeof useQuery<typeof api.catalogue.listCategories>>>;
type Category = Categories["categories"][number];
type Product = NonNullable<ReturnType<typeof useQuery<typeof api.products.productDetails>>>["products"][number];
type IndexRow = NonNullable<ReturnType<typeof useQuery<typeof api.products.productIndex>>>["products"][number];

const PAGE_SIZE = 20;
const BULK_PAGE_SIZE = 50;
type SpecValue = number | string | boolean;
type Notice = { ok: boolean; text: string } | null;

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p className={notice.ok ? "form-success" : "auth-message"} role="status">
      {notice.text}
    </p>
  );
}

const DAY = 24 * 60 * 60 * 1000;

function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Start of a yyyy-mm-dd day in local time (end of it when `end`), or null when empty. */
function dayBound(value: string, end = false) {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d + (end ? 1 : 0)).getTime() - (end ? 1 : 0);
}

/**
 * Changes the cost of every ticked product in one go: by a percentage (rounded to a sensible
 * step) or by typing new figures. Works on whatever the filters above are showing, so a whole
 * category, one brand or supplier, or items added on a given date can be repriced together.
 */
function BulkPrices({
  products,
  tenantId,
  currency,
  onClose
}: {
  products: IndexRow[];
  tenantId: Id<"tenants">;
  currency: string;
  onClose: () => void;
}) {
  const save = useMutation(api.products.setCosts);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [percent, setPercent] = useState("");
  const [step, setStep] = useState("100");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [tablePage, setTablePage] = useState(1);
  const pageCount = Math.ceil(products.length / BULK_PAGE_SIZE);
  const onPage = products.slice((tablePage - 1) * BULK_PAGE_SIZE, tablePage * BULK_PAGE_SIZE);
  const costOf = (p: IndexRow) => (p.pricing?.cost ? Number(p.pricing.cost.amount) : null);
  const ticked = products.filter((p) => !excluded.has(p.id));
  const changes = ticked
    .map((p) => ({ p, amount: Number((drafts[p.id] ?? "").replace(/,/g, "")) }))
    .filter(({ p, amount }) => drafts[p.id]?.trim() && Number.isFinite(amount) && amount > 0 && amount !== costOf(p));

  function applyPercent() {
    const pct = Number(percent);
    if (!Number.isFinite(pct) || pct === 0) {
      setNotice({ ok: false, text: "Enter a percentage such as 5 or -3." });
      return;
    }
    const r = Number(step) || 1;
    const next = { ...drafts };
    let skipped = 0;
    for (const p of ticked) {
      const cost = costOf(p);
      if (cost === null) {
        skipped++;
        continue;
      }
      next[p.id] = String(Math.max(r, Math.round((cost * (1 + pct / 100)) / r) * r));
    }
    setDrafts(next);
    if (!note.trim()) setNote(`Bulk ${pct > 0 ? "+" : ""}${pct}%`);
    setNotice(skipped ? { ok: true, text: `${skipped} ticked product(s) have no cost yet, so type theirs in.` } : null);
  }

  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const res = await save({
        tenantId,
        currency,
        note: note || undefined,
        changes: changes.map(({ p, amount }) => ({ productId: p.id as Id<"products">, amount }))
      });
      setDrafts({});
      setNotice({ ok: true, text: `${res.changed} price${res.changed === 1 ? "" : "s"} updated.` });
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  const allTicked = ticked.length === products.length;
  return (
    <section className="bulk-prices" aria-labelledby="bulk-heading">
      <div className="field-head">
        <h3 id="bulk-heading">Update prices ({ticked.length} of {products.length} ticked)</h3>
        <button type="button" className="button button-secondary button-small" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint">
        Use the filters above to narrow to a category, brand, supplier or date, untick anything to leave alone, then either change
        everything by a percentage or type new costs. Customer prices follow from cost plus margin.
      </p>
      <div className="filter-row">
        <label htmlFor="bulk-percent">Change cost by %</label>
        <input id="bulk-percent" inputMode="decimal" placeholder="e.g. 5 or -3" value={percent} onChange={(e) => setPercent(e.target.value)} />
        <label htmlFor="bulk-step">Round to</label>
        <select id="bulk-step" value={step} onChange={(e) => setStep(e.target.value)}>
          <option value="1">1</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="500">500</option>
          <option value="1000">1,000</option>
        </select>
        <button type="button" className="button button-secondary button-small" onClick={applyPercent}>
          Apply to ticked
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={`Tick all ${products.length}`}
                  checked={allTicked}
                  onChange={() => setExcluded(allTicked ? new Set(products.map((p) => p.id)) : new Set())}
                />{" "}
                Product
              </th>
              <th>Added</th>
              <th>Current cost</th>
              <th>Price updated</th>
              <th>New cost ({currency})</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {onPage.map((p) => {
              const cost = costOf(p);
              const draft = drafts[p.id] ?? "";
              const next = Number(draft.replace(/,/g, ""));
              const diff = cost && draft && Number.isFinite(next) ? ((next - cost) / cost) * 100 : null;
              return (
                <tr key={p.id} className={excluded.has(p.id) ? "row-off" : undefined}>
                  <td className="bulk-name">
                    <label>
                      <input
                        type="checkbox"
                        checked={!excluded.has(p.id)}
                        onChange={() =>
                          setExcluded((s) => {
                            const n = new Set(s);
                            if (n.has(p.id)) n.delete(p.id);
                            else n.add(p.id);
                            return n;
                          })
                        }
                      />{" "}
                      {p.name}
                    </label>
                    <span className="record-meta">
                      {p.brand} · {p.sku}
                    </span>
                  </td>
                  <td>{shortDate(p.addedAt)}</td>
                  <td>{cost !== null ? `${p.pricing?.cost?.currency} ${cost.toLocaleString()}` : "Not set"}</td>
                  <td>{p.pricing?.cost ? shortDate(p.pricing.cost.since) : "—"}</td>
                  <td>
                    <input
                      className="bulk-input"
                      inputMode="decimal"
                      aria-label={`New cost for ${p.name} (${p.brand})`}
                      value={draft}
                      placeholder={cost !== null ? cost.toLocaleString() : ""}
                      onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    />
                  </td>
                  <td>{diff !== null ? `${diff > 0 ? "+" : ""}${diff.toFixed(1)}%` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager page={tablePage} pageCount={pageCount} onPage={setTablePage} />
      <div className="filter-row">
        <label htmlFor="bulk-note">Note</label>
        <input id="bulk-note" maxLength={80} placeholder="e.g. LUMINA price list 1 Dec 2026" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="button" className="button button-small" disabled={busy || changes.length === 0} onClick={submit}>
          {busy ? "Saving…" : `Save ${changes.length} price change${changes.length === 1 ? "" : "s"}`}
        </button>
      </div>
      <NoticeText notice={notice} />
    </section>
  );
}

/** Text-box state for every spec; converted to typed values on submit. */
type SpecDraft = Record<string, string>;

function draftFromValues(category: Category, values: Record<string, SpecValue>): SpecDraft {
  const draft: SpecDraft = {};
  for (const field of category.specFields) {
    const value = values[field.key];
    if (value !== undefined) draft[field.key] = String(value);
  }
  return draft;
}

function valuesFromDraft(category: Category, draft: SpecDraft) {
  const values: Record<string, SpecValue> = {};
  for (const field of category.specFields) {
    const raw = (draft[field.key] ?? "").trim();
    if (raw === "") continue;
    if (field.type === "number") values[field.key] = Number(raw);
    else if (field.type === "boolean") values[field.key] = raw === "true";
    else values[field.key] = raw;
  }
  return values;
}

function SpecInputs({
  category,
  draft,
  onChange,
  idPrefix
}: {
  category: Category;
  draft: SpecDraft;
  onChange: (draft: SpecDraft) => void;
  idPrefix: string;
}) {
  const set = (key: string, value: string) => onChange({ ...draft, [key]: value });
  const fields = category.specFields.filter(
    (f) => !f.retired || draft[f.key] !== undefined
  );

  if (fields.length === 0) return <p className="hint">This category has no specifications defined.</p>;

  return (
    <fieldset className="spec-fieldset">
      <legend>Specifications</legend>
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const label = (
          <label htmlFor={id}>
            {field.label}
            {field.unit ? ` (${field.unit})` : ""}
            {field.required ? " *" : ""}
            {field.critical ? <span className="spec-flag"> · compatibility</span> : null}
          </label>
        );
        const value = draft[field.key] ?? "";
        if (field.type === "number") {
          return (
            <div key={field.key} className="spec-input">
              {label}
              <input id={id} type="number" step="any" inputMode="decimal" value={value} onChange={(e) => set(field.key, e.target.value)} />
            </div>
          );
        }
        if (field.type === "boolean") {
          return (
            <div key={field.key} className="spec-input">
              {label}
              <select id={id} value={value} onChange={(e) => set(field.key, e.target.value)}>
                <option value="">Not stated</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          );
        }
        if (field.type === "choice") {
          return (
            <div key={field.key} className="spec-input">
              {label}
              <select id={id} value={value} onChange={(e) => set(field.key, e.target.value)}>
                <option value="">Not stated</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        return (
          <div key={field.key} className="spec-input">
            {label}
            <input id={id} maxLength={200} value={value} onChange={(e) => set(field.key, e.target.value)} />
          </div>
        );
      })}
    </fieldset>
  );
}

function ProductForm({
  tenantId,
  categories,
  product,
  onDone
}: {
  tenantId: Id<"tenants">;
  categories: Category[];
  product?: Product;
  onDone?: () => void;
}) {
  const create = useMutation(api.products.createProduct);
  const update = useMutation(api.products.updateProduct);
  const editing = product !== undefined;
  const usable = categories.filter((c) => c.status === "active" || c.id === product?.categoryId);

  const [categoryId, setCategoryId] = useState<string>(product?.categoryId ?? usable[0]?.id ?? "");
  const category = categories.find((c) => c.id === categoryId);
  const [name, setName] = useState(product?.name ?? "");
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [supplier, setSupplier] = useState(product?.supplier ?? "");
  const [model, setModel] = useState(product?.model ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [warranty, setWarranty] = useState(product?.warrantyMonths?.toString() ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [draft, setDraft] = useState<SpecDraft>(
    product && category ? draftFromValues(category, product.specValues) : {}
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const prefix = product?.id ?? "new";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!category) return;
    setBusy(true);
    setNotice(null);
    try {
      const common = {
        name,
        brand,
        supplier,
        model,
        sku,
        warrantyMonths: warranty.trim() === "" ? undefined : Number(warranty),
        description,
        specValues: valuesFromDraft(category, draft)
      };
      if (product) {
        await update({ productId: product.id as Id<"products">, ...common, status: product.status });
        setNotice({ ok: true, text: "Product saved." });
        onDone?.();
      } else {
        const { missingCritical } = await create({
          tenantId,
          categoryId: category.id as Id<"productCategories">,
          ...common
        });
        setNotice({
          ok: true,
          text: missingCritical.length
            ? `Product added. It cannot be validated for compatibility until these are filled: ${missingCritical.join(", ")}.`
            : "Product added."
        });
        setName("");
        setBrand("");
        setSupplier("");
        setModel("");
        setSku("");
        setWarranty("");
        setDescription("");
        setDraft({});
      }
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  if (!category) {
    return <p className="muted">Load the standard categories in the Catalogue first.</p>;
  }

  return (
    <form className="panel-form product-form" onSubmit={submit}>
      {editing ? null : <h2>Add a product</h2>}

      <label htmlFor={`${prefix}-category`}>Category</label>
      <select
        id={`${prefix}-category`}
        value={categoryId}
        disabled={editing}
        onChange={(e) => {
          setCategoryId(e.target.value);
          setDraft({});
        }}
      >
        {usable.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label htmlFor={`${prefix}-name`}>Product name</label>
      <input id={`${prefix}-name`} required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor={`${prefix}-brand`}>Brand</label>
      <input id={`${prefix}-brand`} required maxLength={60} value={brand} onChange={(e) => setBrand(e.target.value)} />
      <label htmlFor={`${prefix}-supplier`}>Supplier (optional)</label>
      <input
        id={`${prefix}-supplier`}
        maxLength={60}
        placeholder="Who you buy it from, if not the brand"
        value={supplier}
        onChange={(e) => setSupplier(e.target.value)}
      />
      <label htmlFor={`${prefix}-model`}>Model</label>
      <input id={`${prefix}-model`} required maxLength={60} value={model} onChange={(e) => setModel(e.target.value)} />
      <label htmlFor={`${prefix}-sku`}>SKU</label>
      <input
        id={`${prefix}-sku`}
        required
        maxLength={40}
        autoCapitalize="characters"
        value={sku}
        onChange={(e) => setSku(e.target.value.toUpperCase())}
      />
      <label htmlFor={`${prefix}-warranty`}>Warranty (months)</label>
      <input id={`${prefix}-warranty`} type="number" min={0} max={600} step={1} inputMode="numeric" value={warranty} onChange={(e) => setWarranty(e.target.value)} />
      <label htmlFor={`${prefix}-desc`}>Description (optional)</label>
      <input id={`${prefix}-desc`} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />

      <SpecInputs category={category} draft={draft} onChange={setDraft} idPrefix={prefix} />

      <NoticeText notice={notice} />
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : editing ? "Save product" : "Add product"}
      </button>
    </form>
  );
}

function CostForm({ product, currencies }: { product: Product; currencies: string[] }) {
  const setCost = useMutation(api.products.setCost);
  const [currency, setCurrency] = useState(product.pricing?.cost?.currency ?? currencies[0] ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await setCost({ productId: product.id as Id<"products">, currency, amount: Number(amount) });
      setNotice({ ok: true, text: "Cost recorded." });
      setAmount("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={`cost-cur-${product.id}`}>Currency</label>
      <select id={`cost-cur-${product.id}`} value={currency} onChange={(e) => setCurrency(e.target.value)}>
        {currencies.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <label className="visually-hidden" htmlFor={`cost-amt-${product.id}`}>New unit cost</label>
      <input
        id={`cost-amt-${product.id}`}
        type="number"
        min={0}
        step="any"
        inputMode="decimal"
        required
        placeholder="New unit cost"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button className="button button-small" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Set cost"}
      </button>
      <NoticeText notice={notice} />
    </form>
  );
}

function ProductMarginForm({ product, tenantId }: { product: Product; tenantId: Id<"tenants"> }) {
  const setRule = useMutation(api.margins.setMarginRule);
  const [margin, setMargin] = useState("");
  const [floor, setFloor] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await setRule({
        tenantId,
        scope: "product",
        productId: product.id as Id<"products">,
        marginPercent: Number(margin),
        floorMarginPercent: Number(floor)
      });
      setNotice({ ok: true, text: "Product margin rule saved." });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label className="visually-hidden" htmlFor={`pm-${product.id}`}>Product margin (%)</label>
      <input id={`pm-${product.id}`} type="number" required min={0} max={1000} step="0.01" inputMode="decimal" placeholder="Margin %" value={margin} onChange={(e) => setMargin(e.target.value)} />
      <label className="visually-hidden" htmlFor={`pf-${product.id}`}>Product floor margin (%)</label>
      <input id={`pf-${product.id}`} type="number" required min={0} max={1000} step="0.01" inputMode="decimal" placeholder="Floor %" value={floor} onChange={(e) => setFloor(e.target.value)} />
      <button className="button button-secondary button-small" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Override margin"}
      </button>
      <NoticeText notice={notice} />
    </form>
  );
}

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function ProductFiles({
  product,
  tenantId,
  canManage
}: {
  product: Product;
  tenantId: Id<"tenants">;
  canManage: boolean;
}) {
  const productId = product.id as Id<"products">;
  const files = useQuery(api.files.listFiles, { tenantId, productId });
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const attachFile = useAction(api.files.attachFile);
  const removeFile = useMutation(api.files.removeFile);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function upload(list: FileList | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    setNotice(null);
    let added = 0;
    try {
      for (const file of Array.from(list)) {
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(`"${file.name}" is larger than 15 MB.`);
        }
        const url = await generateUploadUrl({ tenantId, productId });
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file
        });
        if (!response.ok) throw new Error(`Upload of "${file.name}" failed. Please try again.`);
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        await attachFile({ tenantId, productId, storageId, fileName: file.name });
        added += 1;
      }
      setNotice({ ok: true, text: `${added} file${added === 1 ? "" : "s"} added.` });
    } catch (error) {
      const text = error instanceof Error && !("data" in error) ? error.message : errorMessage(error);
      setNotice({ ok: false, text: added > 0 ? `${added} added. ${text}` : text });
    } finally {
      setBusy(false);
    }
  }

  if (!files) return <p className="muted">Loading files…</p>;
  const images = files.filter((f) => f.kind === "image");
  const sheets = files.filter((f) => f.kind === "datasheet");

  const remove = async (id: Id<"productFiles">) => {
    setNotice(null);
    try {
      await removeFile({ fileId: id });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    }
  };

  return (
    <div className="files-panel">
      {images.length > 0 ? (
        <ul className="image-grid">
          {images.map((file) => (
            <li key={file.id}>
              {file.url ? (
                <a href={file.url} target="_blank" rel="noopener noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={file.url} alt={`${product.name}: ${file.fileName}`} loading="lazy" />
                </a>
              ) : null}
              <span className="record-meta">{file.fileName}</span>
              {canManage ? (
                <button type="button" className="button button-secondary button-small" onClick={() => remove(file.id)}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {sheets.length > 0 ? (
        <ul className="record-list">
          {sheets.map((file) => (
            <li className="file-row" key={file.id}>
              {file.url ? (
                <a className="link-summary" href={file.url} target="_blank" rel="noopener noreferrer">
                  {file.fileName}
                </a>
              ) : (
                <span>{file.fileName}</span>
              )}
              <span className="record-meta">PDF · {formatSize(file.size)}</span>
              {canManage ? (
                <button type="button" className="button button-secondary button-small" onClick={() => remove(file.id)}>
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {files.length === 0 ? <p className="hint">No images or datasheets yet.</p> : null}

      {canManage ? (
        <div className="upload-row">
          <label className="button button-secondary button-small" aria-disabled={busy}>
            {busy ? "Uploading…" : "Add images or PDF datasheets"}
            <input
              className="visually-hidden"
              type="file"
              accept={ACCEPT}
              multiple
              disabled={busy}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <span className="hint">PNG, JPEG or WebP up to 5 MB (max 8) · PDF up to 15 MB (max 5).</span>
        </div>
      ) : null}
      <NoticeText notice={notice} />
    </div>
  );
}

function ProductCard({
  product,
  tenantId,
  categories,
  currencies,
  canManage
}: {
  product: Product;
  tenantId: Id<"tenants">;
  categories: Category[];
  currencies: string[];
  canManage: boolean;
}) {
  const update = useMutation(api.products.updateProduct);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const category = categories.find((c) => c.id === product.categoryId);

  const specRows = (category?.specFields ?? [])
    .filter((f) => product.specValues[f.key] !== undefined)
    .map((f) => {
      const value = product.specValues[f.key];
      const shown = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
      return { key: f.key, label: f.label, shown: f.unit ? `${shown} ${f.unit}` : shown };
    });

  async function toggleArchive() {
    setError("");
    try {
      await update({
        productId: product.id as Id<"products">,
        name: product.name,
        brand: product.brand,
        supplier: product.supplier,
        model: product.model,
        sku: product.sku,
        warrantyMonths: product.warrantyMonths ?? undefined,
        description: product.description,
        specValues: product.specValues,
        status: product.status === "active" ? "archived" : "active"
      });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <li className={`product-card${product.status === "archived" ? " field-retired" : ""}`}>
      <div className="field-head">
        <div>
          <span className="record-title">{product.name}</span>
          <span className="record-meta">
            {product.brand} {product.model} · <span className="record-code">{product.sku}</span>
          </span>
          {product.supplier && product.supplier !== product.brand ? (
            <span className="record-meta">Supplier: {product.supplier}</span>
          ) : null}
          <span className="record-meta">{product.categoryName}</span>
          <span className="record-meta">
            Added {shortDate(product.addedAt)}
            {product.pricing?.cost
              ? ` · Price updated ${shortDate(product.pricing.cost.since)}${product.pricing.cost.source ? ` (${product.pricing.cost.source})` : ""}`
              : ""}
          </span>
          <span className="pill-row">
            {product.status === "archived" ? <span className="pill pill-warn">Archived</span> : null}
            {product.missingCritical.length > 0 ? (
              <span className="pill pill-warn">Cannot validate: missing specs</span>
            ) : null}
            {product.specsOutOfDate ? <span className="pill pill-warn">Specs out of date</span> : null}
          </span>
        </div>
        <div className="price-block">
          {product.listPrice ? (
            <>
              <span className="price">
                {product.listPrice.currency} {Number(product.listPrice.amount).toLocaleString()}
              </span>
              <span className="record-meta">List price</span>
            </>
          ) : (
            <span className="record-meta">Price not set</span>
          )}
        </div>
      </div>

      {product.missingCritical.length > 0 ? (
        <p className="hint">Missing for compatibility checks: {product.missingCritical.join(", ")}.</p>
      ) : null}

      {specRows.length > 0 ? (
        <details>
          <summary className="link-summary">Specifications ({specRows.length})</summary>
          <dl className="spec-list">
            {specRows.map((row) => (
              <div key={row.key}>
                <dt>{row.label}</dt>
                <dd>{row.shown}</dd>
              </div>
            ))}
            {product.warrantyMonths !== null ? (
              <div>
                <dt>Warranty</dt>
                <dd>{product.warrantyMonths} months</dd>
              </div>
            ) : null}
          </dl>
        </details>
      ) : null}

      <details>

        <summary className="link-summary">Images &amp; datasheets</summary>

        <ProductFiles product={product} tenantId={tenantId} canManage={canManage} />

      </details>


      {canManage && product.pricing ? (
        <div className="pricing-box">
          <p className="hint">Restricted to pricing administrators.</p>
          <dl className="spec-list">
            <div>
              <dt>Unit cost</dt>
              <dd>
                {product.pricing.cost
                  ? `${product.pricing.cost.currency} ${Number(product.pricing.cost.amount).toLocaleString()}`
                  : "Not set"}
              </dd>
            </div>
            <div>
              <dt>Margin</dt>
              <dd>
                {product.pricing.marginPercent !== null
                  ? `${product.pricing.marginPercent}% (${product.pricing.ruleSource} rule)`
                  : "No margin rule"}
              </dd>
            </div>
            <div>
              <dt>Floor price</dt>
              <dd>
                {product.pricing.floorPrice
                  ? `${product.pricing.floorPrice.currency} ${Number(product.pricing.floorPrice.amount).toLocaleString()} (floor ${product.pricing.floorMarginPercent}%)`
                  : "—"}
              </dd>
            </div>
          </dl>
          <CostForm product={product} currencies={currencies} />
          <ProductMarginForm product={product} tenantId={tenantId} />
        </div>
      ) : null}

      {error ? (
        <p className="auth-message" role="alert">
          {error}
        </p>
      ) : null}

      {canManage ? (
        <div className="record-actions">
          <button type="button" className="button button-secondary button-small" onClick={() => setEditing((o) => !o)}>
            {editing ? "Close editor" : "Edit"}
          </button>
          <button type="button" className="button button-secondary button-small" onClick={toggleArchive}>
            {product.status === "active" ? "Archive" : "Restore"}
          </button>
        </div>
      ) : null}
      {editing ? (
        <ProductForm
          tenantId={tenantId}
          categories={categories}
          product={product}
          onDone={() => setEditing(false)}
        />
      ) : null}
    </li>
  );
}

function Products({ tenantId }: { tenantId: Id<"tenants"> }) {
  const [filter, setFilter] = useState("");
  const [brand, setBrand] = useState("");
  const [supplier, setSupplier] = useState("");
  const [search, setSearch] = useState("");
  const [addedFrom, setAddedFrom] = useState("");
  const [addedTo, setAddedTo] = useState("");
  const [priceAge, setPriceAge] = useState("");
  const [sort, setSort] = useState("name");
  const [bulk, setBulk] = useState(false);
  const [paging, setPaging] = useState({ key: "", page: 1 });
  const catalogue = useQuery(api.catalogue.listCategories, { tenantId });
  const company = useQuery(api.settings.getCompany, { tenantId });
  const data = useQuery(api.products.productIndex, { tenantId });
  const all = data?.products ?? [];

  const brands = [...new Set(all.map((p) => p.brand))].sort();
  const suppliers = [...new Set(all.map((p) => p.supplier).filter(Boolean))].sort();
  const term = search.trim().toLowerCase();
  const words = searchWords(search);
  const searchOptions: Suggestion[] = [
    ...countInto("category", all.map((p) => ({ value: p.categoryId, label: p.categoryName }))),
    ...countInto("brand", all.map((p) => ({ value: p.brand }))),
    ...countInto("supplier", all.map((p) => ({ value: p.supplier }))),
    ...countInto("product", all.map((p) => ({ value: p.name })))
  ];
  const from = dayBound(addedFrom);
  const to = dayBound(addedTo, true);
  const now = Date.now();
  const shown = all
    .filter((p) => {
      if (filter && p.categoryId !== filter) return false;
      if (brand && p.brand !== brand) return false;
      if (supplier && p.supplier !== supplier) return false;
      if (words.length && !matchesWords(`${p.name} ${p.brand} ${p.model} ${p.sku} ${p.categoryName} ${p.supplier}`, words)) return false;
      if (from !== null && p.addedAt < from) return false;
      if (to !== null && p.addedAt > to) return false;
      const since = p.pricing?.cost?.since ?? null;
      if (priceAge === "never") return since === null;
      if (priceAge) return since !== null && now - since > Number(priceAge) * DAY;
      return true;
    })
    .sort((a, b) => {
      if (sort === "newest") return b.addedAt - a.addedAt;
      if (sort === "stale") return (a.pricing?.cost?.since ?? 0) - (b.pricing?.cost?.since ?? 0);
      return a.name.localeCompare(b.name);
    });
  const filtered = Boolean(filter || brand || supplier || term || from || to || priceAge);
  const filterKey = [filter, brand, supplier, term, addedFrom, addedTo, priceAge, sort].join("|");
  const pageCount = Math.ceil(shown.length / PAGE_SIZE);
  const page = pageFor(paging, filterKey, pageCount);
  const pageIds = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((p) => p.id);
  const details = useQuery(api.products.productDetails, data ? { tenantId, ids: pageIds } : "skip");
  // Keep the cards that are already on screen while the next page loads.
  const [lastCards, setLastCards] = useState<Product[]>([]);
  if (details && details.products !== lastCards && details.products.map((p) => p.id).join() === pageIds.join()) setLastCards(details.products);
  const cards = details?.products ?? lastCards;

  if (!catalogue || !company || !data) return <p className="muted">Loading products…</p>;

  function goTo(next: number) {
    setPaging({ key: filterKey, page: next });
    document.getElementById("products-heading")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      {data.canManage ? (
        <ProductForm tenantId={tenantId} categories={catalogue.categories} />
      ) : null}

      <section aria-labelledby="products-heading" className="workspace-section">
        <h2 id="products-heading">
          Products ({shown.length === all.length ? all.length : `${shown.length} of ${all.length}`})
        </h2>
        <div className="filter-row">
          <label htmlFor="category-filter">Category</label>
          <select id="category-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All categories</option>
            {catalogue.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label htmlFor="brand-filter">Brand</label>
          <select id="brand-filter" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">All brands</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
          {suppliers.length > 0 ? (
            <>
              <label htmlFor="supplier-filter">Supplier</label>
              <select id="supplier-filter" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
                <option value="">All suppliers</option>
                {suppliers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <SearchSuggest
            id="product-search"
            label="Search products"
            placeholder="Search: e.g. solar panel, Deye, 48V"
            value={search}
            onChange={setSearch}
            suggestions={searchOptions}
            kindLabels={{ category: "Category", brand: "Brand", supplier: "Supplier", product: "Product" }}
            onPick={(s) => {
              // A category, brand or supplier becomes that filter; a product name searches for it.
              if (s.kind === "category") { setSearch(""); setFilter(s.value); }
              else if (s.kind === "brand") { setSearch(""); setBrand(s.value); }
              else if (s.kind === "supplier") { setSearch(""); setSupplier(s.value); }
              else setSearch(s.value);
            }}
          />
        </div>
        <div className="filter-row">
          <label htmlFor="added-from">Added from</label>
          <input id="added-from" type="date" value={addedFrom} onChange={(e) => setAddedFrom(e.target.value)} />
          <label htmlFor="added-to">to</label>
          <input id="added-to" type="date" value={addedTo} onChange={(e) => setAddedTo(e.target.value)} />
          {data.canManage ? (
            <>
              <label htmlFor="price-age">Price last changed</label>
              <select id="price-age" value={priceAge} onChange={(e) => setPriceAge(e.target.value)}>
                <option value="">Any time</option>
                <option value="30">Over 30 days ago</option>
                <option value="60">Over 60 days ago</option>
                <option value="90">Over 90 days ago</option>
                <option value="never">Never priced</option>
              </select>
            </>
          ) : null}
          <label htmlFor="product-sort">Sort</label>
          <select id="product-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="name">Name</option>
            <option value="newest">Newest added</option>
            {data.canManage ? <option value="stale">Oldest price first</option> : null}
          </select>
          {filtered ? (
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => {
                setFilter("");
                setBrand("");
                setSupplier("");
                setSearch("");
                setAddedFrom("");
                setAddedTo("");
                setPriceAge("");
              }}
            >
              Clear filters
            </button>
          ) : null}
        </div>
        {data.canManage && shown.length > 0 ? (
          bulk ? (
            <BulkPrices
              key={shown.map((p) => p.id).join()}
              products={shown}
              tenantId={tenantId}
              currency={company.defaultCurrency}
              onClose={() => setBulk(false)}
            />
          ) : (
            <p>
              <button type="button" className="button button-small" onClick={() => setBulk(true)}>
                Update prices for these {shown.length} product{shown.length === 1 ? "" : "s"}
              </button>
            </p>
          )
        ) : null}
        {shown.length === 0 ? (
          <p className="muted">
            {all.length === 0 ? `No products yet.${data.canManage ? " Add your first one above." : ""}` : "No products match these filters."}
          </p>
        ) : (
          <>
          {data.truncated ? <p className="hint">Showing the first 3,000 products only.</p> : null}
          <ul className="record-list" aria-busy={!details}>
            {cards.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                tenantId={tenantId}
                categories={catalogue.categories}
                currencies={company.supportedCurrencies}
                canManage={data.canManage}
              />
            ))}
          </ul>
          <Pager page={page} pageCount={pageCount} onPage={goTo} />
          </>
        )}
      </section>
    </>
  );
}

export default function ProductsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Products">{(company) => <Products tenantId={company.tenantId} />}</CompanyPage>
    </ConfiguredOnly>
  );
}
