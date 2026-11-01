"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";

function SettingsForm({ tenantId }: { tenantId: Id<"tenants"> }) {
  const company = useQuery(api.settings.getCompany, { tenantId });
  const update = useMutation(api.settings.updateCompany);

  const [name, setName] = useState("");
  const [defaultCurrency, setDefaultCurrency] = useState("");
  const [others, setOthers] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!company) return;
    setName(company.name);
    setDefaultCurrency(company.defaultCurrency);
    setOthers(
      company.supportedCurrencies.filter((c) => c !== company.defaultCurrency).join(", ")
    );
  }, [company]);

  if (!company) return <p className="muted">Loading settings…</p>;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const result = await update({
        tenantId,
        name,
        defaultCurrency,
        supportedCurrencies: others.split(/[\s,]+/).filter(Boolean)
      });
      setNotice({ ok: true, text: result.changed ? "Settings saved." : "No changes to save." });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <label htmlFor="company-name">Company name</label>
      <input
        id="company-name"
        value={name}
        maxLength={80}
        required
        onChange={(e) => setName(e.target.value)}
      />

      <label htmlFor="default-currency">Default currency</label>
      <input
        id="default-currency"
        value={defaultCurrency}
        maxLength={3}
        required
        autoCapitalize="characters"
        onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
      />
      <p className="hint">Three-letter ISO code, for example UGX. Prices default to this currency.</p>

      <label htmlFor="other-currencies">Other supported currencies</label>
      <input
        id="other-currencies"
        value={others}
        placeholder="USD, KES"
        onChange={(e) => setOthers(e.target.value.toUpperCase())}
      />
      <p className="hint">Separate codes with commas. Currencies are never mixed silently in quotations.</p>

      {notice ? (
        <p className={notice.ok ? "form-success" : "auth-message"} role="status">
          {notice.text}
        </p>
      ) : null}
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

export default function SettingsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Company settings" allowedRoles={["super_admin"]}>
        {(company) => <SettingsForm tenantId={company.tenantId} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
