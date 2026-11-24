"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../workspace";
import { WhatsappAgents } from "./WhatsappAgents";

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

function EstimatorForm({ tenantId }: { tenantId: Id<"tenants"> }) {
  const settings = useQuery(api.estimator.getEstimatorSettings, { tenantId });
  const update = useMutation(api.estimator.updateEstimatorSettings);
  const [enabled, setEnabled] = useState(false);
  const [tariff, setTariff] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [publicSignUp, setPublicSignUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!settings) return;
    setEnabled(settings.enabled);
    setTariff(settings.tariffMinorPerKwh ? String(settings.tariffMinorPerKwh / 10 ** settings.exponent) : "");
    setPhone(settings.contactPhone);
    setEmail(settings.contactEmail);
    setWhatsapp(settings.whatsappNumber ? `+${settings.whatsappNumber}` : "");
    setPublicSignUp(settings.publicSignUp);
  }, [settings]);

  if (!settings) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      await update({ tenantId, enabled, tariffPerKwh: Number(tariff || 0), contactPhone: phone, contactEmail: email, whatsappNumber: whatsapp, publicSignUp });
      setNotice({ ok: true, text: "Power check settings saved." });
    } catch (error) {
      setNotice({ ok: false, text: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Public power check</h2>
      <p className="hint">
        Lets anyone work out what power they use and see unverified solar options without prices at /estimate.
        They can then request a quote.
      </p>
      <label htmlFor="pc-enabled">
        <input id="pc-enabled" type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{" "}
        Switch the public power check on
      </label>
      <label htmlFor="pc-tariff">Electricity price per kWh ({settings.currency})</label>
      <input id="pc-tariff" type="number" min="0" step="any" inputMode="decimal" value={tariff} onChange={(e) => setTariff(e.target.value)} />
      <p className="hint">Used to estimate running cost when a customer does not enter their own price. Take it from the current ERA tariff for your customers and update it when it changes.</p>
      <label htmlFor="pc-phone">Contact phone shown to customers (optional)</label>
      <input id="pc-phone" type="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="pc-email">Contact email (optional)</label>
      <input id="pc-email" type="email" maxLength={120} value={email} onChange={(e) => setEmail(e.target.value)} />
      <label htmlFor="pc-whatsapp">WhatsApp number for requests (optional)</label>
      <input id="pc-whatsapp" type="tel" maxLength={30} placeholder="+256 700 000000" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
      <p className="hint">
        When set, customers who ask for a recommendation or an upgrade can also send it to this number on WhatsApp,
        with their details and a link that opens the request in the app. Leave empty to switch this off.
      </p>
      <label htmlFor="pc-signup">
        <input id="pc-signup" type="checkbox" checked={publicSignUp} onChange={(e) => setPublicSignUp(e.target.checked)} />{" "}
        Let the public create accounts
      </label>
      <p className="hint">
        Off: only staff you invite on the Staff page can create an account. Customers can still check their needs,
        see the shop with prices, order and send requests without an account. People who already have an account can
        always sign in.
      </p>
      {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
      <button className="button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save power check settings"}</button>
    </form>
  );
}

export default function SettingsPage() {
  return (
    <ConfiguredOnly>
      <CompanyPage title="Company settings" allowedRoles={["super_admin"]}>
        {(company) => (
          <>
            <SettingsForm tenantId={company.tenantId} />
            <EstimatorForm tenantId={company.tenantId} />
            <WhatsappAgents tenantId={company.tenantId} />
          </>
        )}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
