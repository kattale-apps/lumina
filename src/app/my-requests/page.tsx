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

type Mine = NonNullable<FunctionReturnType<typeof api.responses.myRequests>>;

function money(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}

function Page({ children, signedIn }: { children: ReactNode; signedIn?: boolean }) {
  return <CustomerShell signedIn={signedIn}>{children}</CustomerShell>;
}

function Request({ r, mine, contactPhone }: { r: Mine["requests"][number]; mine: Mine; contactPhone: string | null }) {
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
      setError(e instanceof ConvexError && typeof e.data === "string" ? e.data : "Something went wrong. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="my-request">
      <p className="my-request-meta">{when} · {r.location} · {r.dailyKwh} kWh a day</p>
      {!r.response ? (
        <div className="my-request-waiting">
          <strong>⏳ A technician is reviewing your needs</strong>
          <p>Your recommendation, with options, photos and prices, will appear here. We may also call you to check a few details.</p>
        </div>
      ) : (
        <>
          <p className="my-request-message">{r.response.message}</p>
          <div className="my-options">
            {r.response.options.map((o, i) => {
              const chosen = r.response!.chosenOptionKey === o.key;
              return (
                <section key={o.key} className={chosen ? "my-option my-option-chosen" : "my-option"}>
                  <span className="my-option-num">Option {i + 1}</span>
                  <h3>{o.title}</h3>
                  {o.images.length ? (
                    <div className="my-option-photos">
                      {o.images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={img.id} src={img.url} alt={`${o.title}, photo`} loading="lazy" />
                      ))}
                    </div>
                  ) : null}
                  {o.description ? <p>{o.description}</p> : null}
                  <ul className="my-option-parts">
                    {o.components.map((c, ci) => <li key={ci}>{c.quantity} × {c.name}</li>)}
                  </ul>
                  <p className="my-option-price">
                    {o.priceMinor !== null ? <>About <strong>{money(o.priceMinor, mine.exponent, mine.currency)}</strong></> : "Price shared on the call"}
                  </p>
                  {chosen ? (
                    <p className="form-success">✅ You chose this. We will call you to arrange a site visit.</p>
                  ) : r.closed ? null : (
                    <button type="button" className="button" disabled={busy !== null} onClick={() => pick(o.key)}>
                      {busy === o.key ? "Sending…" : "I want this option"}
                    </button>
                  )}
                </section>
              );
            })}
          </div>
          <p className="hint">Prices are estimates until a technician has visited the site. {contactPhone ? `Questions? Call ${contactPhone}.` : ""}</p>
        </>
      )}
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
    </article>
  );
}

function Mine() {
  const me = useQuery(api.shop.myAccount, {});
  const ready = Boolean(me?.signedIn && me.account);
  useClaimPendingRequests(ready);
  const mine = useQuery(api.responses.myRequests, ready ? {} : "skip");
  const config = useQuery(api.estimator.publicConfig, {});
  const contactPhone = config?.enabled ? config.contactPhone ?? null : null;

  if (me === undefined) return <Page><p className="muted">Loading…</p></Page>;
  if (!me.signedIn) {
    return (
      <Page>
        <h1>My recommendations</h1>
        <p>Sign in or create a free account to see the system recommendation, options, photos and prices our technicians prepare for you.</p>
        <div className="hero-actions">
          <Link className="button" href="/sign-up?next=/my-requests">Create an account</Link>
          <Link className="button button-secondary" href="/sign-in">Sign in</Link>
        </div>
      </Page>
    );
  }
  if (!me.account) {
    return (
      <Page signedIn>
        <h1>My recommendations</h1>
        <p>Finish setting up your customer account first.</p>
        <Link className="button" href="/shop">Finish my account</Link>
      </Page>
    );
  }
  return (
    <Page signedIn>
      <h1>My recommendations</h1>
      {mine === undefined ? <p className="muted">Loading…</p> : null}
      {mine && mine.requests.length === 0 ? (
        <>
          <p className="muted">You have not asked for a recommendation yet.</p>
          <Link className="button" href="/estimate">Check my power needs</Link>
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
