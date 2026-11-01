"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

type Notice = { ok: boolean; text: string } | null;

const SCOPE_LABELS = {
  default: "Company default",
  category: "Category",
  product: "Single product"
} as const;

function RuleForm({ tenantId }: { tenantId: Id<"tenants"> }) {
  const catalogue = useQuery(api.catalogue.listCategories, { tenantId });
  const setRule = useMutation(api.margins.setMarginRule);
  const [scope, setScope] = useState<"default" | "category">("default");
  const [categoryId, setCategoryId] = useState("");
  const [margin, setMargin] = useState("");
  const [floor, setFloor] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await setRule({
        tenantId,
        scope,
        categoryId: scope === "category" ? (categoryId as Id<"productCategories">) : undefined,
        marginPercent: Number(margin),
        floorMarginPercent: Number(floor)
      });
      setNotice({ ok: true, text: result.changed ? "Rule saved." : "No changes to save." });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Set a margin rule</h2>
      <p className="hint">
        Price = cost + margin. The floor margin is the lowest margin any discount may reach. The most
        specific rule applies: single product, then category, then company default.
      </p>

      <label htmlFor="rule-scope">Applies to</label>
      <select id="rule-scope" value={scope} onChange={(e) => setScope(e.target.value as "default" | "category")}>
        <option value="default">{SCOPE_LABELS.default}</option>
        <option value="category">{SCOPE_LABELS.category}</option>
      </select>

      {scope === "category" ? (
        <>
          <label htmlFor="rule-category">Category</label>
          <select id="rule-category" required value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            <option value="">Choose a category…</option>
            {(catalogue?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </>
      ) : null}

      <label htmlFor="rule-margin">Target margin (%)</label>
      <input id="rule-margin" type="number" required min={0} max={1000} step="0.01" inputMode="decimal" value={margin} onChange={(e) => setMargin(e.target.value)} />
      <label htmlFor="rule-floor">Floor margin (%)</label>
      <input id="rule-floor" type="number" required min={0} max={1000} step="0.01" inputMode="decimal" value={floor} onChange={(e) => setFloor(e.target.value)} />
      <p className="hint">Override the margin for a single product from its card on the Products page. Overrides can be removed here.</p>

      <NoticeText notice={notice} />
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save rule"}
      </button>
    </form>
  );
}

function NoticeText({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p className={notice.ok ? "form-success" : "auth-message"} role="status">
      {notice.text}
    </p>
  );
}

function Rules({ tenantId }: { tenantId: Id<"tenants"> }) {
  const rules = useQuery(api.margins.listMarginRules, { tenantId });
  const remove = useMutation(api.margins.removeMarginRule);
  const [error, setError] = useState("");

  if (!rules) return <p className="muted">Loading margin rules…</p>;

  return (
    <>
      <RuleForm tenantId={tenantId} />
      <section aria-labelledby="rules-heading" className="workspace-section">
        <h2 id="rules-heading">Margin rules ({rules.length})</h2>
        {error ? (
          <p className="auth-message" role="alert">
            {error}
          </p>
        ) : null}
        {rules.length === 0 ? (
          <p className="muted">
            No margin rules yet. Products have no list price until a rule applies to them.
          </p>
        ) : (
          <ul className="record-list">
            {rules.map((rule) => (
              <li className="record-card" key={rule.id}>
                <div>
                  <span className="record-title">{rule.targetName}</span>
                  <span className="record-meta">
                    {SCOPE_LABELS[rule.scope]} · margin {rule.marginPercent}% · floor {rule.floorMarginPercent}%
                  </span>
                </div>
                {rule.scope === "default" ? null : (
                  <div className="record-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={async () => {
                        setError("");
                        try {
                          await remove({ ruleId: rule.id });
                        } catch (e) {
                          setError(errorMessage(e));
                        }
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function PricingPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Pricing rules" allowedRoles={["super_admin", "inventory_admin"]}>
        {(company) => <Rules tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
