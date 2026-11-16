"use client";

import Link from "next/link";
import { CustomerShell } from "@/components/CustomerShell";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useClaimPendingRequests } from "@/lib/pendingRequests";
import { useMarkSeen } from "@/lib/appInbox";
import { Rich, useT } from "@/lib/i18n";

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

function Mine() {
  const t = useT();
  const me = useQuery(api.shop.myAccount, {});
  const ready = Boolean(me?.signedIn && me.account);
  useClaimPendingRequests(ready);
  const mine = useQuery(api.responses.myRequests, ready ? {} : "skip");
  const inbox = useQuery(api.inbox.myInbox, ready ? {} : "skip");
  useMarkSeen("customer", mine !== undefined && mine !== null, inbox?.customer);
  const config = useQuery(api.estimator.publicConfig, {});
  const contactPhone = config?.enabled ? config.contactPhone ?? null : null;

  if (me === undefined) return <Page><p className="muted">{t("common.loading")}</p></Page>;
  if (!me.signedIn) {
    return (
      <Page>
        <h1>{t("requests.title")}</h1>
        <p>{t("requests.signedOut")}</p>
        <div className="hero-actions">
          <Link className="button" href="/sign-up?next=/my-requests">{t("requests.createAccount")}</Link>
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
      {mine === undefined ? <p className="muted">{t("common.loading")}</p> : null}
      {mine && mine.requests.length === 0 ? (
        <>
          <p className="muted">{t("requests.none")}</p>
          <Link className="button" href="/estimate">{t("requests.checkPower")}</Link>
        </>
      ) : null}
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
