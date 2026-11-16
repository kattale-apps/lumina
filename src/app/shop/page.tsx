"use client";

import Link from "next/link";
import { CustomerShell } from "@/components/CustomerShell";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { hasPendingRequests } from "@/lib/pendingRequests";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";

function msg(e: unknown, fallback: string) {
  return e instanceof ConvexError && typeof e.data === "string" ? e.data : fallback;
}

function money(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}

function Page({ children, signedIn }: { children: ReactNode; signedIn?: boolean }) {
  return <CustomerShell signedIn={signedIn}>{children}</CustomerShell>;
}

function CompleteAccount() {
  const t = useT();
  const register = useMutation(api.shop.registerCustomer);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await register({ name, phone });
    } catch (err) {
      setError(msg(err, t("common.genericError")));
    }
  }
  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>{t("shop.finishTitle")}</h2>
      <p className="hint">{t("shop.finishHint")}</p>
      <label htmlFor="ca-name">{t("signup.name")}</label>
      <input id="ca-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="ca-phone">{t("signup.phone")}</label>
      <input id="ca-phone" required type="tel" placeholder="+256 700 000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <button className="button" type="submit">{t("shop.continue")}</button>
    </form>
  );
}

function Shop() {
  const t = useT();
  const data = useQuery(api.shop.catalogue, {});
  const orders = useQuery(api.shop.myOrders, {});
  const place = useMutation(api.shop.placeOrder);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState(false);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    const map = new Map<string, typeof data.products>();
    for (const p of data.products) {
      if (term && !`${p.name} ${p.brand} ${p.model}`.toLowerCase().includes(term)) continue;
      map.set(p.category, [...(map.get(p.category) ?? []), p]);
    }
    return [...map.entries()];
  }, [data, search]);

  if (data === undefined) return <p className="muted">{t("shop.loading")}</p>;

  const byId = new Map(data.products.map((p) => [p.id as string, p]));
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ id, qty, p: byId.get(id) }))
    .filter((l): l is { id: string; qty: number; p: NonNullable<typeof l.p> } => Boolean(l.p));
  const total = lines.reduce((sum, l) => sum + (l.p.priceMinor ?? 0) * l.qty, 0);
  const currency = lines[0]?.p.currency ?? "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await place({
        items: lines.map((l) => ({ productId: l.id as Id<"products">, quantity: l.qty })),
        deliveryLocation: location,
        note: note || undefined
      });
      setCart({});
      setPlaced(true);
    } catch (err) {
      setError(msg(err, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">{data.companyName.toUpperCase()}</p>
      <h1>{t("shop.title")}</h1>
      <p className="muted">{t("shop.intro")}</p>

      {placed ? (
        <p className="form-success" role="status">{t("shop.thanks")}</p>
      ) : null}

      <label className="visually-hidden" htmlFor="shop-search">{t("shop.search")}</label>
      <input id="shop-search" className="shop-search" type="search" placeholder={t("shop.searchPlaceholder")} value={search} onChange={(e) => setSearch(e.target.value)} />

      {grouped.length === 0 ? <p className="muted">{t("shop.none")}</p> : null}
      {grouped.map(([category, items]) => (
        <section key={category} className="workspace-section">
          <h2>{category}</h2>
          <div className="shop-grid">
            {items.map((p) => (
              <article className="option-card" key={p.id}>
                <h3>{p.name}</h3>
                <p className="muted">
                  {[p.brand, p.model].filter(Boolean).join(" · ")}
                  {p.warrantyMonths ? t("shop.warranty", { months: p.warrantyMonths }) : ""}
                </p>
                {p.description ? <p className="hint">{p.description}</p> : null}
                <p className="stat-value">
                  {p.priceMinor !== null && p.currency ? money(p.priceMinor, data.exponent, p.currency) : t("shop.priceOnRequest")}
                </p>
                {p.priceMinor !== null ? (
                  cart[p.id] ? (
                    <div className="quick-row">
                      <button type="button" className="chip" aria-label={t("shop.fewer", { name: p.name })} onClick={() => setCart((c) => { const n = { ...c, [p.id]: c[p.id] - 1 }; if (n[p.id] < 1) delete n[p.id]; return n; })}>−</button>
                      <strong>{cart[p.id]}</strong>
                      <button type="button" className="chip" aria-label={t("shop.more", { name: p.name })} onClick={() => setCart((c) => ({ ...c, [p.id]: Math.min(1000, c[p.id] + 1) }))}>+</button>
                    </div>
                  ) : (
                    <button type="button" className="button button-small" onClick={() => { setPlaced(false); setCart((c) => ({ ...c, [p.id]: 1 })); }}>
                      {t("shop.add")}
                    </button>
                  )
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ))}

      {lines.length > 0 ? (
        <form className="panel-form" onSubmit={submit}>
          <h2>{t("shop.yourOrder")}</h2>
          <ul className="component-list">
            {lines.map((l) => (
              <li key={l.id}>
                <strong>{l.qty} × {l.p.name}</strong>
                <span>{money((l.p.priceMinor ?? 0) * l.qty, data.exponent, l.p.currency ?? currency)}</span>
              </li>
            ))}
          </ul>
          <p className="stat-value">{t("shop.total", { amount: money(total, data.exponent, currency) })}</p>
          <label htmlFor="o-loc">{t("shop.delivery")}</label>
          <input id="o-loc" required maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />
          <label htmlFor="o-note">{t("shop.note")}</label>
          <input id="o-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <p className="auth-message" role="alert">{error}</p> : null}
          <button className="button" type="submit" disabled={busy}>{busy ? t("requests.sending") : t("shop.place")}</button>
        </form>
      ) : null}

      {orders && orders.length > 0 ? (
        <section className="workspace-section">
          <h2>{t("shop.yourOrders")}</h2>
          <ul className="company-list">
            {orders.map((o) => (
              <li className="company-card" key={o.id}>
                <span className="company-name">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</span>
                <span className="company-role">
                  {money(o.totalMinor, data.exponent, o.currency)} · {o.status === "new" ? t("shop.status.new") : o.status === "confirmed" ? t("shop.status.confirmed") : t("shop.status.cancelled")}
                </span>
                <span className="company-meta">{new Date(o.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Gate() {
  const t = useT();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.shop.myAccount, isAuthenticated ? {} : "skip");
  const router = useRouter();
  const ready = Boolean(me?.signedIn && me.account);
  // Someone who asked for a recommendation before signing up goes to see it; that page attaches it.
  useEffect(() => {
    if (ready && hasPendingRequests()) router.replace("/my-requests");
  }, [ready, router]);

  if (isLoading || (isAuthenticated && me === undefined)) return <Page><p className="muted">{t("common.loading")}</p></Page>;
  if (!isAuthenticated || !me?.signedIn) {
    return (
      <Page>
        <h1>{t("shop.signedOutTitle")}</h1>
        <p className="muted">{t("shop.signedOutText")}</p>
        <div className="hero-actions">
          <Link className="button" href="/sign-up">{t("requests.createAccount")}</Link>
          <Link className="button button-secondary" href="/sign-in">{t("common.signIn")}</Link>
        </div>
      </Page>
    );
  }
  if (!me.account) return <Page signedIn><CompleteAccount /></Page>;
  return <Page signedIn><Shop /></Page>;
}

export default function ShopPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return <Unavailable />;
  return <Gate />;
}

function Unavailable() {
  const t = useT();
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{t("shop.unavailable")}</h1>
        <p>{t("common.tryLater")}</p>
      </section>
    </main>
  );
}
