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

type Grid = "none" | "unreliable" | "reliable";
const GRID_CHOICES: { value: Grid; label: string }[] = [
  { value: "reliable", label: "Mostly reliable" },
  { value: "unreliable", label: "Often goes off" },
  { value: "none", label: "No grid power" }
];

function message(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  return "Something went wrong. Check your connection and try again.";
}

export default function UpgradeCheckPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Upgrade check unavailable</h1>
          <p>This page is not connected yet. Please try again later.</p>
        </section>
      </main>
    );
  }
  return <UpgradeCheck />;
}

function UpgradeCheck() {
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

  if (config === undefined) return <Shell><p className="muted">Loading…</p></Shell>;
  if (!config.enabled) {
    return (
      <Shell>
        <h1>The upgrade check is not open yet</h1>
        <p className="muted">Please check back soon, or contact us directly.</p>
      </Shell>
    );
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    const payload = toPayload(form);
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
      setError(message(e));
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
      setError(e instanceof AppUpdateNeeded ? e.message : "We could not create the PDF. Please try again.");
    } finally {
      setPdfBusy(false);
    }
  }

  async function request(event: FormEvent) {
    event.preventDefault();
    if (!checked) return;
    if (!grid) {
      setError("Tell us how reliable your grid power is.");
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
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Shell>
        <h1>Thank you, {(hasCustomerAccount ? customer.account!.name : contact.name).split(" ")[0]}</h1>
        <p>
          We have the details of your system. A technician will review them and prepare a recommendation with prices.
          We may call you on <strong>{hasCustomerAccount ? customer.account!.phone : contact.phone}</strong>, and we will
          need to see the equipment before anything is final.
        </p>
        {done.hasAccount ? (
          <div className="next-step next-step-ok">
            <strong>✅ It will appear in your account</strong>
            <p>Open My recommendations to see it as soon as it is ready.</p>
            <Link className="button" href="/my-requests">Go to My recommendations</Link>
          </div>
        ) : (
          <div className="next-step">
            <strong>📲 Sign up to get your recommendation in the app</strong>
            <p>Create a free account on this phone to receive your recommendation with options and prices.</p>
            <Link className="button" href="/sign-up?next=/my-requests">Create my free account</Link>
            <p className="hint">
              Already have an account? <Link href="/sign-in"><u>Sign in</u></Link> on this phone and your request is added to it.
            </p>
          </div>
        )}
        {config.contactPhone ? <p className="muted">Questions? Call {config.contactPhone}.</p> : null}
        <Link className="button button-secondary" href="/">Back to home</Link>
      </Shell>
    );
  }

  const usable = checked !== null && checked.report.blockers.length === 0;

  return (
    <Shell>
      <p className="eyebrow">{config.companyName.toUpperCase()}</p>
      <h1>Already have solar? Check your upgrade</h1>
      <p className="muted">
        Tell us what is installed and what you want from it. We work out what your system can take, such as the battery
        voltage it needs and how many more panels fit, and which parts could be added or swapped.
      </p>
      <p className="hint">
        Starting from nothing instead? <Link href="/estimate"><u>Use the power check</u></Link>.
      </p>

      <form className="panel-form estimate-form" onSubmit={calculate}>
        <UpgradeForm state={form} setState={setForm} audience="public" />
        {error && !checked ? <p className="auth-message" role="alert">{error}</p> : null}
        <button className="button" type="submit" disabled={busy}>{busy && !asking ? "Working it out…" : "Check my system"}</button>
      </form>

      {checked ? (
        <section id="results" className="estimate-results" aria-live="polite">
          <h2>Your upgrade report</h2>
          <UpgradeReport
            report={checked.report}
            selected={selected}
            onToggle={usable ? (key) => setSelected((s) => toggleOption(checked.report, s, key)) : undefined}
          />

          {usable ? (
            <>
              <div className="result-block result-report report-download">
                <button type="button" className="button button-secondary" disabled={pdfBusy} onClick={downloadReport}>
                  {pdfBusy ? "Preparing PDF…" : "Download this report (PDF)"}
                </button>
                <p className="hint">Prices are shared when you request a quote.</p>
              </div>

              <div className={`recommend-card ${asking ? "option-on" : ""}`}>
                <h3>{selected.length > 0 ? `Request a quote for the ${selected.length} option${selected.length === 1 ? "" : "s"} you chose` : "Not sure which to choose?"}</h3>
                <p>
                  Send us these details and a technician will confirm what fits your system and prepare a quotation.
                  It is free and there is no obligation.
                </p>
                <button
                  type="button"
                  className="button"
                  onClick={() => { setAsking(true); setError(null); setTimeout(() => document.getElementById("request")?.scrollIntoView({ behavior: "smooth" }), 50); }}
                >
                  {selected.length > 0 ? "Request a quote" : "Ask a technician to recommend"}
                </button>
              </div>
            </>
          ) : null}

          {asking && usable ? (
            <form id="request" className="panel-form" onSubmit={request}>
              <h2>Request your quote</h2>
              <p className="hint">We will contact you with a quotation that includes prices. No payment is needed now.</p>
              <p className="field-label" id="rq-grid">How reliable is your grid power?</p>
              <div className="quick-row" role="radiogroup" aria-labelledby="rq-grid">
                {GRID_CHOICES.map((g) => (
                  <button key={g.value} type="button" role="radio" aria-checked={grid === g.value} className={grid === g.value ? "chip chip-on" : "chip"} onClick={() => setGrid(g.value)}>
                    {g.label}
                  </button>
                ))}
              </div>
              {customer === undefined ? (
                <p className="hint">Checking your account…</p>
              ) : signedInCustomer && !hasCustomerAccount ? (
                <p className="hint">Your sign-in is active, but your customer account setup is incomplete. Please <Link href="/shop"><u>finish setting up your customer account</u></Link> before requesting a quotation.</p>
              ) : hasCustomerAccount ? (
                <div className="signed-in-request">
                  <strong>Requesting as {customer.account!.name}</strong>
                  {customer.email ? <p className="hint">{customer.email}</p> : null}
                  <label htmlFor="rq-loc">Where is the system? (town / area)</label>
                  <input id="rq-loc" required maxLength={200} autoComplete="address-level2" value={contact.location} onChange={(e) => setContact({ ...contact, location: e.target.value })} />
                </div>
              ) : (
                <>
                  <label htmlFor="rq-name">Your name</label>
                  <input id="rq-name" required maxLength={100} autoComplete="name" value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} />
                  <label htmlFor="rq-phone">Phone</label>
                  <input id="rq-phone" required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
                  <label htmlFor="rq-email">Email (optional)</label>
                  <input id="rq-email" type="email" maxLength={120} autoComplete="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                  <label htmlFor="rq-loc">Where is the system? (town / area)</label>
                  <input id="rq-loc" required maxLength={200} autoComplete="address-level2" value={contact.location} onChange={(e) => setContact({ ...contact, location: e.target.value })} />
                </>
              )}
              <div className="honeypot" aria-hidden="true">
                <label htmlFor="rq-site">Website</label>
                <input id="rq-site" tabIndex={-1} autoComplete="off" value={contact.website} onChange={(e) => setContact({ ...contact, website: e.target.value })} />
              </div>
              {error ? <p className="auth-message" role="alert">{error}</p> : null}
              <button className="button" type="submit" disabled={busy || customer === undefined || (signedInCustomer && !hasCustomerAccount)}>{busy ? "Sending…" : "Send my request"}</button>
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
  return (
    <div className="public-bg">
      <div className="shell">
        <header className="topbar">
          <Link className="brand" href="/" aria-label="Solar Switch home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="brand-logo" src="/icons/icon-192.png" alt="" width={38} height={38} />
            <span>SOLAR SWITCH</span>
          </Link>
          <Link className="button button-small button-secondary" href="/sign-in">Staff sign in</Link>
        </header>
        <main className="workspace">{children}</main>
      </div>
    </div>
  );
}
