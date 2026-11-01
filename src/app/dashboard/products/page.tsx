"use client";

import { useState, type FormEvent } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

type Categories = NonNullable<ReturnType<typeof useQuery<typeof api.catalogue.listCategories>>>;
type Category = Categories["categories"][number];
type Products = NonNullable<ReturnType<typeof useQuery<typeof api.products.listProducts>>>;
type Product = Products["products"][number];
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
          <span className="record-meta">{product.categoryName}</span>
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
  const catalogue = useQuery(api.catalogue.listCategories, { tenantId });
  const company = useQuery(api.settings.getCompany, { tenantId });
  const data = useQuery(api.products.listProducts, {
    tenantId,
    categoryId: filter ? (filter as Id<"productCategories">) : undefined
  });

  if (!catalogue || !company || !data) return <p className="muted">Loading products…</p>;

  return (
    <>
      {data.canManage ? (
        <ProductForm tenantId={tenantId} categories={catalogue.categories} />
      ) : null}

      <section aria-labelledby="products-heading" className="workspace-section">
        <h2 id="products-heading">Products ({data.products.length})</h2>
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
        </div>
        {data.products.length === 0 ? (
          <p className="muted">
            No products yet.{data.canManage ? " Add your first one above." : ""}
          </p>
        ) : (
          <ul className="record-list">
            {data.products.map((product) => (
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
