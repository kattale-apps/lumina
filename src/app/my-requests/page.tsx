"use client";

import Link from "next/link";
import { CustomerShell } from "@/components/CustomerShell";
import { useEffect, useState, type ReactNode } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useClaimPendingRequests } from "@/lib/pendingRequests";
import { useMarkSeen } from "@/lib/appInbox";
import { Rich, useT, type MessageKey } from "@/lib/i18n";
import { en } from "@/lib/i18n/en";
import { clearPendingEstimate, readPendingEstimate, type PendingEstimate } from "@/lib/pendingEstimate";

type Mine = NonNullable<FunctionReturnType<typeof api.responses.myRequests>>;

function money(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}

function Page({ children, signedIn }: { children: ReactNode; signedIn?: boolean }) {
  return <CustomerShell signedIn={signedIn}>{children}</CustomerShell>;
}

function Request({ r, mine, contactPhone }: { r: Mine["requests"][number]; mine: Mine; contactPhone: string | null }) {
  const t = useT();
  const choose = useMutation(api.responses.chooseOption);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const when = new Date(r.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  async function pick(key: string) {
    setBusy(key);
    setError(null);
    try {
      await choose({ requestId: r.id as Id<"quoteRequests">, optionKey: key });
    } catch (e) {
      setError(e instanceof ConvexError && typeof e.data === "string" ? e.data : t("common.genericError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="my-request">
      <p className="my-request-meta">{r.isUpgrade ? t("requests.metaUpgrade", { date: when, location: r.location }) : t("requests.meta", { date: when, location: r.location, kwh: r.dailyKwh })}</p>
      {!r.response ? (
        <div className="my-request-waiting">
          <strong>{t("requests.waitingTitle")}</strong>
          <p>{t("requests.waitingText")}</p>
        </div>
      ) : (
        <>
          <p className="my-request-message">{r.response.message}</p>
          <div className="my-options">
            {r.response.options.map((o, i) => {
              const chosen = r.response!.chosenOptionKey === o.key;
              return (
                <section key={o.key} className={chosen ? "my-option my-option-chosen" : "my-option"}>
                  <span className="my-option-num">{t("requests.option", { number: i + 1 })}</span>
                  <h3>{o.title}</h3>
                  {o.images.length ? (
                    <div className="my-option-photos">
                      {o.images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={img.id} src={img.url} alt={t("requests.photoAlt", { title: o.title })} loading="lazy" />
                      ))}
                    </div>
                  ) : null}
                  {o.description ? <p>{o.description}</p> : null}
                  <ul className="my-option-parts">
                    {o.components.map((c, ci) => <li key={ci}>{c.quantity} × {c.name}</li>)}
                  </ul>
                  <p className="my-option-price">
                    {o.priceMinor !== null ? <Rich text={t("requests.priceAbout", { price: money(o.priceMinor, mine.exponent, mine.currency) })} /> : t("requests.priceOnCall")}
                  </p>
                  {chosen ? (
                    <p className="form-success">{t("requests.chosen")}</p>
                  ) : r.closed ? null : (
                    <button type="button" className="button" disabled={busy !== null} onClick={() => pick(o.key)}>
                      {busy === o.key ? t("requests.sending") : t("requests.choose")}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
          <p className="hint">{t("requests.priceNote")} {contactPhone ? t("common.questionsCall", { phone: contactPhone }) : ""}</p>
        </>
      )}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
    </article>
  );
}

/**
 * The energy check this person ran before signing up. The options are worked out again from
 * today's catalogue and one can be sent for a priced quote, under the account's name and phone.
 */
function SavedCheck() {
  const t = useT();
  const convex = useConvex();
  const submit = useMutation(api.estimator.submitRequest);
  const [saved, setSaved] = useState<PendingEstimate | null>(null);
  const [result, setResult] = useState<FunctionReturnType<typeof api.estimator.recommend> | null>(null);
  const [failed, setFailed] = useState(false);
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const check = readPendingEstimate();
    setSaved(check);
    if (!check) return;
    convex
      .query(api.estimator.recommend, { input: check.input, grid: check.grid })
      .then(setResult)
      .catch(() => setFailed(true));
  }, [convex]);

  if (sent) return <p className="form-success" role="status">{t("requests.savedSent")}</p>;
  if (!saved) return null;
  const optionLabel = (key: string, fallback: string) => {
    const k = key as MessageKey;
    return k in en ? t(k) : fallback;
  };

  async function send(optionKey: string) {
    if (!saved) return;
    setBusy(optionKey);
    setError(null);
    try {
      await submit({ input: saved.input, grid: saved.grid, optionKey, location });
      clearPendingEstimate();
      setSent(true);
    } catch (e) {
      setError(e instanceof ConvexError && typeof e.data === "string" ? e.data : t("common.genericError"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="saved-check" aria-labelledby="saved-check-title">
      <h2 id="saved-check-title">{t("requests.savedTitle")}</h2>
      {failed ? <p className="muted">{t("requests.savedFailed")}</p> : null}
      {!failed && !result ? <p className="muted">{t("common.loading")}</p> : null}
      {result ? (
        <>
          <p className="muted">{t("requests.savedIntro", { kwh: result.summary.dailyKwh })}</p>
          {result.options.length === 0 ? <p className="muted">{t("requests.savedNone")}</p> : null}
          {result.options.length > 0 ? (
            <div className="panel-form saved-location">
              <label htmlFor="saved-loc">{t("requests.savedLocation")}</label>
              <input id="saved-loc" required maxLength={200} autoComplete="address-level2" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          ) : null}
          <div className="option-list">
            {result.options.map((o) => (
              <article key={o.key} className="option-card">
                <h3>{optionLabel(`option.${o.key}.title`, o.title)}</h3>
                <ul className="option-facts">
                  <li className={o.cutsBill ? "fact-yes" : "fact-no"}>{o.cutsBill ? t("estimate.factBill") : t("estimate.factNoBill")}</li>
                  <li className={o.key === "bill_saver" ? "fact-no" : "fact-yes"}>
                    {t("estimate.factOutage", { text: optionLabel(`option.${o.key}.outage`, o.duringOutage) })}
                  </li>
                </ul>
                <ul className="component-list">
                  {o.components.map((c) => (
                    <li key={c.role}>
                      <strong>{c.quantity} × {c.role}</strong>
                      <span>{[c.brand, c.model ?? c.name].filter(Boolean).join(" ")}{c.detail ? ` · ${c.detail}` : ""}</span>
                      {c.estimated ? <span className="pill pill-warn">{t("estimate.specsPending")}</span> : null}
                    </li>
                  ))}
                </ul>
                <button type="button" className="button" disabled={busy !== null || !location.trim()} onClick={() => void send(o.key)}>
                  {busy === o.key ? t("common.pleaseWait") : t("requests.savedSend")}
                </button>
              </article>
            ))}
          </div>
        </>
      ) : null}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <button type="button" className="button button-small button-secondary" onClick={() => { clearPendingEstimate(); setSaved(null); }}>
        {t("requests.savedDiscard")}
      </button>
    </section>
  );
}

function Mine() {
  const t = useT();
  const me = useQuery(api.shop.myAccount, {});
  const ready = Boolean(me?.signedIn && me.account);
  useClaimPendingRequests(ready);
  const mine = useQuery(api.responses.myRequests, ready ? {} : "skip");
  const inbox = useQuery(api.inbox.myInbox, ready ? {} : "skip");
  useMarkSeen("customer", mine !== undefined && mine !== null, inbox?.customer);
  const config = useQuery(api.estimator.publicConfig, {});
  const signUp = useQuery(api.access.signUpStatus, {});
  const contactPhone = config?.enabled ? config.contactPhone ?? null : null;

  if (me === undefined) return <Page><p className="muted">{t("common.loading")}</p></Page>;
  if (!me.signedIn) {
    return (
      <Page>
        <h1>{t("requests.title")}</h1>
        <p>{t("requests.signedOut")}</p>
        <div className="hero-actions">
          {signUp?.publicSignUpOpen ? <Link className="button" href="/sign-up?next=/my-requests">{t("requests.createAccount")}</Link> : null}
          <Link className="button button-secondary" href="/sign-in">{t("common.signIn")}</Link>
        </div>
      </Page>
    );
  }
  if (!me.account) {
    return (
      <Page signedIn>
        <h1>{t("requests.title")}</h1>
        <p>{t("requests.finishAccount")}</p>
        <Link className="button" href="/shop">{t("requests.finishAccountButton")}</Link>
      </Page>
    );
  }
  return (
    <Page signedIn>
      <h1>{t("requests.title")}</h1>
      <div className="check-actions">
        <Link className="button" href="/estimate">⚡ {t("requests.checkPower")}</Link>
        <Link className="button button-secondary" href="/estimate/upgrade">🔧 {t("requests.checkSystem")}</Link>
      </div>
      <SavedCheck />
      {mine === undefined ? <p className="muted">{t("common.loading")}</p> : null}
      {mine && mine.requests.length === 0 ? <p className="muted">{t("requests.none")}</p> : null}
      {mine?.requests.map((r) => <Request key={r.id} r={r} mine={mine} contactPhone={contactPhone} />)}
    </Page>
  );
}

export default function MyRequestsPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Unavailable</h1>
          <p>Please try again later.</p>
        </section>
      </main>
    );
  }
  return <Mine />;
}
