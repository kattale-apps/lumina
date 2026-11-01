"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

type Category = NonNullable<
  ReturnType<typeof useQuery<typeof api.catalogue.listCategories>>
>["categories"][number];
type Field = Category["specFields"][number];
type FieldType = Field["type"];

const TYPE_LABELS: Record<FieldType, string> = {
  number: "Number",
  text: "Text",
  boolean: "Yes / no",
  choice: "Choice"
};

type Notice = { ok: boolean; text: string } | null;

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p className={notice.ok ? "form-success" : "auth-message"} role="status">
      {notice.text}
    </p>
  );
}

function keyFromLabel(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "")
    .slice(0, 40);
}

function FieldForm({
  category,
  field,
  onDone
}: {
  category: Category;
  field?: Field;
  onDone?: () => void;
}) {
  const save = useMutation(api.catalogue.saveSpecField);
  const editing = field !== undefined;
  const [label, setLabel] = useState(field?.label ?? "");
  const [key, setKey] = useState(field?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(false);
  const [type, setType] = useState<FieldType>(field?.type ?? "number");
  const [unit, setUnit] = useState(field?.unit ?? "");
  const [options, setOptions] = useState((field?.options ?? []).join("\n"));
  const [required, setRequired] = useState(field?.required ?? false);
  const [critical, setCritical] = useState(field?.critical ?? false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const idPrefix = `${category.id}-${field?.key ?? "new"}`;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await save({
        categoryId: category.id,
        key,
        label,
        type,
        unit: type === "number" ? unit : undefined,
        options: type === "choice" ? options.split("\n") : undefined,
        required,
        critical
      });
      if (editing) {
        setNotice({ ok: true, text: "Field saved." });
        onDone?.();
      } else {
        setNotice({ ok: true, text: `Field "${label}" added.` });
        setLabel("");
        setKey("");
        setKeyTouched(false);
        setUnit("");
        setOptions("");
        setRequired(false);
        setCritical(false);
      }
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form field-form" onSubmit={submit}>
      <label htmlFor={`${idPrefix}-label`}>Label</label>
      <input
        id={`${idPrefix}-label`}
        required
        maxLength={60}
        value={label}
        onChange={(e) => {
          setLabel(e.target.value);
          if (!editing && !keyTouched) setKey(keyFromLabel(e.target.value));
        }}
      />

      <label htmlFor={`${idPrefix}-key`}>Key</label>
      <input
        id={`${idPrefix}-key`}
        required
        maxLength={40}
        value={key}
        disabled={editing}
        onChange={(e) => {
          setKey(e.target.value.toLowerCase());
          setKeyTouched(true);
        }}
      />
      <p className="hint">
        {editing
          ? "The key and type are permanent so stored product values stay valid."
          : "Permanent identifier: lowercase letters, digits and underscores."}
      </p>

      <label htmlFor={`${idPrefix}-type`}>Type</label>
      <select
        id={`${idPrefix}-type`}
        value={type}
        disabled={editing}
        onChange={(e) => setType(e.target.value as FieldType)}
      >
        {Object.entries(TYPE_LABELS).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>

      {type === "number" ? (
        <>
          <label htmlFor={`${idPrefix}-unit`}>Unit</label>
          <input
            id={`${idPrefix}-unit`}
            maxLength={12}
            placeholder="V, A, Wp, kWh…"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
          />
          <p className="hint">Always state the unit. Leave blank only for plain counts.</p>
        </>
      ) : null}

      {type === "choice" ? (
        <>
          <label htmlFor={`${idPrefix}-options`}>Options (one per line)</label>
          <textarea
            id={`${idPrefix}-options`}
            rows={4}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
          {editing ? <p className="hint">Existing options cannot be removed, only added to.</p> : null}
        </>
      ) : null}

      <label className="check-row">
        <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
        Required when adding a product
      </label>
      <label className="check-row">
        <input type="checkbox" checked={critical} onChange={(e) => setCritical(e.target.checked)} />
        Needed for sizing and compatibility checks
      </label>

      <NoticeText notice={notice} />
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : editing ? "Save field" : "Add field"}
      </button>
    </form>
  );
}

function FieldRow({ category, field, canManage }: { category: Category; field: Field; canManage: boolean }) {
  const setRetired = useMutation(api.catalogue.setSpecFieldRetired);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");

  return (
    <li className={`field-row${field.retired ? " field-retired" : ""}`}>
      <div className="field-head">
        <div>
          <span className="record-title">{field.label}</span>
          <span className="record-meta">
            {TYPE_LABELS[field.type]}
            {field.unit ? ` · ${field.unit}` : ""}
            {field.options ? ` · ${field.options.join(", ")}` : ""}
          </span>
          <span className="pill-row">
            {field.required ? <span className="pill pill-info">Required</span> : null}
            {field.critical ? <span className="pill pill-info">Compatibility</span> : null}
            {field.retired ? <span className="pill pill-warn">Retired</span> : null}
          </span>
        </div>
        {canManage ? (
          <div className="record-actions">
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => setEditing((open) => !open)}
            >
              {editing ? "Close" : "Edit"}
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={async () => {
                setError("");
                try {
                  await setRetired({
                    categoryId: category.id,
                    key: field.key,
                    retired: !field.retired
                  });
                } catch (e) {
                  setError(errorMessage(e));
                }
              }}
            >
              {field.retired ? "Restore" : "Retire"}
            </button>
          </div>
        ) : null}
      </div>
      {error ? (
        <p className="auth-message" role="alert">
          {error}
        </p>
      ) : null}
      {editing ? (
        <FieldForm category={category} field={field} onDone={() => setEditing(false)} />
      ) : null}
    </li>
  );
}

function CategoryCard({ category, canManage }: { category: Category; canManage: boolean }) {
  const update = useMutation(api.catalogue.updateCategory);
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description);
  const [notice, setNotice] = useState<Notice>(null);
  const [showAdd, setShowAdd] = useState(false);
  const activeFields = category.specFields.filter((f) => !f.retired).length;

  async function saveDetails(status: "active" | "archived") {
    setNotice(null);
    try {
      const result = await update({ categoryId: category.id, name, description, status });
      setNotice({ ok: true, text: result.changed ? "Category saved." : "No changes to save." });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    }
  }

  return (
    <details className="category-card">
      <summary>
        <span className="record-title">{category.name}</span>
        <span className="record-meta">
          {activeFields} specification{activeFields === 1 ? "" : "s"} · v{category.schemaVersion}
        </span>
        {category.status === "archived" ? <span className="pill pill-warn">Archived</span> : null}
      </summary>

      <div className="category-body">
        {category.description ? <p className="muted">{category.description}</p> : null}

        {canManage ? (
          <form
            className="panel-form"
            onSubmit={(e) => {
              e.preventDefault();
              void saveDetails(category.status);
            }}
          >
            <label htmlFor={`${category.id}-name`}>Category name</label>
            <input
              id={`${category.id}-name`}
              required
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label htmlFor={`${category.id}-desc`}>Description</label>
            <input
              id={`${category.id}-desc`}
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <NoticeText notice={notice} />
            <div className="record-actions">
              <button className="button button-small" type="submit">
                Save
              </button>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => void saveDetails(category.status === "active" ? "archived" : "active")}
              >
                {category.status === "active" ? "Archive category" : "Restore category"}
              </button>
            </div>
          </form>
        ) : null}

        {category.specFields.length === 0 ? (
          <p className="muted">No specifications defined yet.</p>
        ) : (
          <ul className="field-list">
            {category.specFields.map((field) => (
              <FieldRow key={field.key} category={category} field={field} canManage={canManage} />
            ))}
          </ul>
        )}

        {canManage ? (
          <>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => setShowAdd((open) => !open)}
            >
              {showAdd ? "Hide new field form" : "Add a specification"}
            </button>
            {showAdd ? <FieldForm category={category} /> : null}
          </>
        ) : null}
      </div>
    </details>
  );
}

function AddCategory({ tenantId }: { tenantId: Id<"tenants"> }) {
  const create = useMutation(api.catalogue.createCategory);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await create({ tenantId, name });
      setNotice({ ok: true, text: `Category "${name.trim()}" created. Open it to add specifications.` });
      setName("");
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Add a custom category</h2>
      <label htmlFor="cat-name">Category name</label>
      <input id="cat-name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
      <NoticeText notice={notice} />
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Adding…" : "Add category"}
      </button>
    </form>
  );
}

function Catalogue({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.catalogue.listCategories, { tenantId });
  const loadStandard = useMutation(api.catalogue.loadStandardCategories);
  const [loadNotice, setLoadNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(false);

  if (!data) return <p className="muted">Loading catalogue…</p>;

  return (
    <>
      <p className="muted">
        Categories define which specifications each product must carry, with explicit units.
        Values marked for compatibility are what sizing checks rely on; a product missing one
        cannot be validated.
      </p>

      {data.canManage ? (
        <section className="workspace-section">
          <h2>Standard solar categories</h2>
          <p className="hint">
            Adds panels, inverters, batteries, charge controllers, mounting, protection, cables and
            accessories with standard electrical specifications. Categories you already have are not
            changed.
          </p>
          <NoticeText notice={loadNotice} />
          <button
            type="button"
            className="button"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              setLoadNotice(null);
              try {
                const { added } = await loadStandard({ tenantId });
                setLoadNotice({
                  ok: true,
                  text: added.length
                    ? `Added ${added.length} categor${added.length === 1 ? "y" : "ies"}.`
                    : "All standard categories are already loaded."
                });
              } catch (error) {
                setLoadNotice({ ok: false, text: errorMessage(error) });
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "Loading…" : "Load standard categories"}
          </button>
        </section>
      ) : null}

      <section aria-labelledby="cat-heading" className="workspace-section">
        <h2 id="cat-heading">Categories ({data.categories.length})</h2>
        {data.categories.length === 0 ? (
          <p className="muted">
            No categories yet.{data.canManage ? " Load the standard set above to begin." : ""}
          </p>
        ) : (
          <div className="category-list">
            {data.categories.map((category) => (
              <CategoryCard key={category.id} category={category} canManage={data.canManage} />
            ))}
          </div>
        )}
      </section>

      {data.canManage ? <AddCategory tenantId={tenantId} /> : null}
    </>
  );
}

export default function CataloguePage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Product catalogue">{(company) => <Catalogue tenantId={company.tenantId} />}</CompanyPage>
    </ConfiguredOnly>
  );
}
