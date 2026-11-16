"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../../convex/_generated/api";
import { rememberPendingRequest } from "../../../lib/pendingRequests";
import { AppUpdateNeeded, savePdf } from "../../../lib/savePdf";
import { describeNeeds, describeSystem, type ExistingSystem, type UpgradeNeeds } from "./describe";
import { blankUpgradeForm, toPayload, UpgradeForm } from "./UpgradeForm";
import { toggleOption, UpgradeReport, type Report } from "./UpgradeReport";
import { DraftNotice, LanguagePicker, Rich, useT } from "@/lib/i18n";

type Grid = "none" | "unreliable" | "reliable";
const GRID_CHOICES: Grid[] = ["reliable", "unreliable", "none"];

function message(error: unknown, fallback: string) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return fallback;
}

export default function UpgradeCheckPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return <Unavailable />;
  return <UpgradeCheck />;
}

function Unavailable() {
  const t = useT();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{t("upgrade.unavailable")}</h1>
        <p>{t("upgrade.unavailableHint")}</p>
      </section>
    </main>
  );
}

function UpgradeCheck() {
  const t = useT();
  const convex = useConvex();
  const config = useQuery(api.upgrades.publicConfig, {});
  const customer = useQuery(api.shop.myAccount, {});
  const submit = useMutation(api.upgrades.submitUpgradeRequest);

  const [form, setForm] = useState(blankUpgradeForm);
  // What the shown report was calculated from, so the request and the PDF match the screen.
  const [checked, setChecked] = useState<{ system: ExistingSystem; needs: UpgradeNeeds; report: Report } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [grid, setGrid] = useState<Grid | null>(null);
  const [contact, setContact] = useState({ name: "", phone: "", email: "", location: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { hasAccount: boolean }>(null);

  const signedInCustomer = customer?.signedIn === true;
  const hasCustomerAccount = signedInCustomer && customer.account !== null;

  if (config === undefined) return <Shell><p className="muted">{t("common.loading")}</p></Shell>;
  if (!config.enabled) {
    return (
      <Shell>
        <h1>{t("upgrade.notOpen")}</h1>
        <p className="muted">{t("estimate.notOpenHint")}</p>
      </Shell>
    );
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    const payload = toPayload(form, t);
    if (!payload.ok) {
      setError(payload.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const report = await convex.query(api.upgrades.publicSimulate, { system: payload.system, needs: payload.needs });
      setChecked({ system: payload.system, needs: payload.needs, report });
      setSelected([]);
      setAsking(false);
      setTimeout(() => document.getElementById("results")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (e) {
      setChecked(null);
      setError(message(e, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  async function downloadReport() {
    if (!checked || !config?.enabled) return;
    setPdfBusy(true);
    try {
      const { buildUpgradeReportPdf } = await import("./upgradeReportPdf");
      const bytes = await buildUpgradeReportPdf({
        companyName: config.companyName,
        preparedAt: Date.now(),
        systemLines: describeSystem(checked.system),
        needsLines: describeNeeds(checked.needs),
        report: checked.report,
        selected
      });
      await savePdf(bytes, `solar-upgrade-report-${new Date().toISOString().slice(0, 10)}.pdf`, "Solar upgrade report");
    } catch (e) {
      setError(e instanceof AppUpdateNeeded ? e.message : t("estimate.errPdf"));
    } finally {
      setPdfBusy(false);
    }
  }

  async function request(event: FormEvent) {
    event.preventDefault();
    if (!checked) return;
    if (!grid) {
      setError(t("upgrade.errGrid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sent = await submit({
        system: checked.system,
        needs: checked.needs,
        grid,
        optionKeys: selected,
        // The server takes these from the account when signed in, so only send them otherwise.
        name: hasCustomerAccount ? undefined : contact.name,
        phone: hasCustomerAccount ? undefined : contact.phone,
        email: hasCustomerAccount ? undefined : contact.email || undefined,
        location: contact.location,
        website: contact.website || undefined
      });
      if (sent.claimToken) rememberPendingRequest(sent.claimToken);
      setDone({ hasAccount: sent.hasAccount });
    } catch (e) {
      setError(message(e, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell>
        <h1>{t("estimate.thanks", { name: (hasCustomerAccount ? customer.account!.name : contact.name).split(" ")[0] })}</h1>
        <p>
          <Rich text={t("upgrade.thanksText", { phone: hasCustomerAccount ? customer.account!.phone : contact.phone })} />
        </p>
        {done.hasAccount ? (
          <div className="next-step next-step-ok">
            <strong>{t("estimate.inAccountTitle")}</strong>
            <p>{t("estimate.inAccountText")}</p>
            <Link className="button" href="/my-requests">{t("estimate.goToRecommendations")}</Link>
          </div>
        ) : (
          <div className="next-step">
            <strong>{t("estimate.signUpTitle")}</strong>
            <p>{t("upgrade.signUpText")}</p>
            <Link className="button" href="/sign-up?next=/my-requests">{t("estimate.signUpButton")}</Link>
            <p className="hint">
              <Rich text={t("estimate.signInInstead")} link={(label) => <Link href="/sign-in"><u>{label}</u></Link>} />
            </p>
          </div>
        )}
        {config.contactPhone ? <p className="muted">{t("common.questionsCall", { phone: config.contactPhone })}</p> : null}
        <Link className="button button-secondary" href="/">{t("estimate.backHome")}</Link>
      </Shell>
    );
  }

  const usable = checked !== null && checked.report.blockers.length === 0;

  return (
    <Shell>
      <h1>{t("upgrade.title")}</h1>
      <p className="muted">{t("upgrade.intro")}</p>
      <p className="hint">
        <Rich text={t("upgrade.fromNothing")} link={(label) => <Link href="/estimate"><u>{label}</u></Link>} />
      </p>

      <form className="panel-form estimate-form" onSubmit={calculate}>
        <UpgradeForm state={form} setState={setForm} audience="public" />
        {error && !checked ? <p className="auth-message" role="alert">{error}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy && !asking ? t("estimate.working") : t("upgrade.check")}</button>
      </form>

      {checked ? (
        <section id="results" className="estimate-results" aria-live="polite">
          <h2>{t("upgrade.reportTitle")}</h2>
          <UpgradeReport
            report={checked.report}
            selected={selected}
            onToggle={usable ? (key) => setSelected((s) => toggleOption(checked.report, s, key)) : undefined}
          />

          {usable ? (
            <>
              <div className="result-block result-report report-download">
                <button type="button" className="button button-secondary" disabled={pdfBusy} onClick={downloadReport}>
                  {pdfBusy ? t("estimate.preparingPdf") : t("upgrade.downloadPdf")}
                </button>
                <p className="hint">{t("upgrade.pricesOnRequest")}</p>
              </div>

              <div className={`recommend-card ${asking ? "option-on" : ""}`}>
                <h3>{selected.length === 1 ? t("upgrade.requestChosenOne") : selected.length > 1 ? t("upgrade.requestChosen", { count: selected.length }) : t("upgrade.notSure")}</h3>
                <p>{t("upgrade.sendText")}</p>
                <button
                  type="button"
                  className="button"
                  onClick={() => { setAsking(true); setError(null); setTimeout(() => document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }), 50); }}
                >
                  {selected.length > 0 ? t("upgrade.requestQuote") : t("upgrade.askTechnician")}
                </button>
              </div>
            </>
          ) : null}

          {asking && usable ? (
            <form id="request" className="panel-form" onSubmit={request}>
              <h2>{t("estimate.formTitleQuote")}</h2>
              <p className="hint">{t("estimate.formHintQuote")}</p>
              <p className="field-label" id="rq-grid">{t("upgrade.gridQuestion")}</p>
              <div className="quick-row" role="radiogroup" aria-labelledby="rq-grid">
                {GRID_CHOICES.map((g) => (
                  <button key={g} type="button" role="radio" aria-checked={grid === g} className={grid === g ? "chip chip-on" : "chip"} onClick={() => setGrid(g)}>
                    {t(`estimate.grid.${g}`)}
                  </button>
                ))}
              </div>
              {customer === undefined ? (
                <p className="hint">{t("estimate.checkingAccount")}</p>
              ) : signedInCustomer && !hasCustomerAccount ? (
                <p className="hint"><Rich text={t("estimate.accountIncomplete")} link={(label) => <Link href="/shop"><u>{label}</u></Link>} /></p>
              ) : hasCustomerAccount ? (
                <div className="signed-in-request">
                  <strong>{t("estimate.requestingAs", { name: customer.account!.name })}</strong>
                  {customer.email ? <p className="hint">{customer.email}</p> : null}
                  <label htmlFor="rq-loc">{t("upgrade.location")}</label>
                  <input id="rq-loc" required maxLength={200} autoComplete="address-level2" value={contact.location} onChange={(e) => setContact({ ...contact, location: e.target.value })} />
                </div>
              ) : (
                <>
                  <label htmlFor="rq-name">{t("estimate.yourName")}</label>
                  <input id="rq-name" required maxLength={100} autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                  <label htmlFor="rq-phone">{t("estimate.phone")}</label>
                  <input id="rq-phone" required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
                  <label htmlFor="rq-email">{t("estimate.emailOptional")}</label>
                  <input id="rq-email" type="email" maxLength={120} autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                  <label htmlFor="rq-loc">{t("upgrade.location")}</label>
                  <input id="rq-loc" required maxLength={200} autoComplete="address-level2" value={contact.location} onChange={(e) => setContact({ ...contact, location: e.target.value })} />
                </>
              )}
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="rq-site">Website</label>
                <input id="rq-site" tabIndex={-1} autoComplete="off" value={contact.website} onChange={(e) => setContact({ ...contact, website: e.target.value })} />
              </div>
              {error ? <p className="auth-message" role="alert">{error}</p> : null}
              <button className="button" type="submit" disabled={busy || customer === undefined || (signedInCustomer && !hasCustomerAccount)}>{busy ? t("estimate.sending") : t("estimate.send")}</button>
            </form>
          ) : error && checked ? (
            <p className="auth-message" role="alert">{error}</p>
          ) : null}
        </section>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="public-bg">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label={t("common.brandHome")}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <div className="topbar-actions">
            <LanguagePicker />
            <Link className="button button-small button-secondary" href="/sign-in">{t("estimate.staffSignIn")}</Link>
          </div>
        </header>
        <DraftNotice />
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
