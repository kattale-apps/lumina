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

function msg(e: unknown) {
  return e instanceof ConvexError && typeof e.data === "string"
    ? e.data
    : "Something went wrong. Check your connection and try again.";
}

function money(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}

function Page({ children, signedIn }: { children: ReactNode; signedIn?: boolean }) {
  return <CustomerShell signedIn={signedIn}>{children}</CustomerShell>;
}

function CompleteAccount() {
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
      setError(msg(err));
    }
  }
  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>Finish your customer account</h2>
      <p className="hint">Add your details so we can contact you about orders.</p>
      <label htmlFor="ca-name">Your name</label>
      <input id="ca-name" required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="ca-phone">Phone</label>
      <input id="ca-phone" required type="tel" placeholder="+256 700 000000" value={phone} onChange={(e) => setPhone(e.target.value)} />
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <button className="button" type="submit">Continue</button>
    </form>
  );
}

function Shop() {
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

  if (data === undefined) return <p className="muted">Loading the catalogue…</p>;

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
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="eyebrow">{data.companyName.toUpperCase()}</p>
      <h1>Product catalogue</h1>
      <p className="muted">
        Browse everything we sell. Prices are list prices; we confirm your order with you before anything is delivered.
      </p>

      {placed ? (
        <p className="form-success" role="status">Thank you. Your order has been sent and we will contact you to confirm it.</p>
      ) : null}

      <label className="visually-hidden" htmlFor="shop-search">Search products</label>
      <input id="shop-search" className="shop-search" type="search" placeholder="Search products, brands or models" value={search} onChange={(e) => setSearch(e.target.value)} />

      {grouped.length === 0 ? <p className="muted">No products found.</p> : null}
      {grouped.map(([category, items]) => (
        <section key={category} className="workspace-section">
          <h2>{category}</h2>
          <div className="shop-grid">
            {items.map((p) => (
              <article className="option-card" key={p.id}>
                <h3>{p.name}</h3>
                <p className="muted">
                  {[p.brand, p.model].filter(Boolean).join(" · ")}
                  {p.warrantyMonths ? ` · ${p.warrantyMonths} month warranty` : ""}
                </p>
                {p.description ? <p className="hint">{p.description}</p> : null}
                <p className="stat-value">
                  {p.priceMinor !== null && p.currency ? money(p.priceMinor, data.exponent, p.currency) : "Price on request"}
                </p>
                {p.priceMinor !== null ? (
                  cart[p.id] ? (
                    <div className="quick-row">
                      <button type="button" className="chip" aria-label={`Fewer ${p.name}`} onClick={() => setCart((c) => { const n = { ...c, [p.id]: c[p.id] - 1 }; if (n[p.id] < 1) delete n[p.id]; return n; })}>−</button>
                      <strong>{cart[p.id]}</strong>
                      <button type="button" className="chip" aria-label={`More ${p.name}`} onClick={() => setCart((c) => ({ ...c, [p.id]: Math.min(1000, c[p.id] + 1) }))}>+</button>
                    </div>
                  ) : (
                    <button type="button" className="button button-small" onClick={() => { setPlaced(false); setCart((c) => ({ ...c, [p.id]: 1 })); }}>
                      Add to order
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
          <h2>Your order</h2>
          <ul className="component-list">
            {lines.map((l) => (
              <li key={l.id}>
                <strong>{l.qty} × {l.p.name}</strong>
                <span>{money((l.p.priceMinor ?? 0) * l.qty, data.exponent, l.p.currency ?? currency)}</span>
              </li>
            ))}
          </ul>
          <p className="stat-value">Total: {money(total, data.exponent, currency)}</p>
          <label htmlFor="o-loc">Delivery location (town / area)</label>
          <input id="o-loc" required maxLength={200} value={location} onChange={(e) => setLocation(e.target.value)} />
          <label htmlFor="o-note">Note (optional)</label>
          <input id="o-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          {error ? <p className="auth-message" role="alert">{error}</p> : null}
          <button className="button" type="submit" disabled={busy}>{busy ? "Sending…" : "Place order"}</button>
        </form>
      ) : null}

      {orders && orders.length > 0 ? (
        <section className="workspace-section">
          <h2>Your orders</h2>
          <ul className="company-list">
            {orders.map((o) => (
              <li className="company-card" key={o.id}>
                <span className="company-name">{o.items.map((i) => `${i.quantity} × ${i.name}`).join(", ")}</span>
                <span className="company-role">
                  {money(o.totalMinor, data.exponent, o.currency)} · {o.status === "new" ? "Received" : o.status === "confirmed" ? "Confirmed" : "Cancelled"}
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
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.shop.myAccount, isAuthenticated ? {} : "skip");
  const router = useRouter();
  const ready = Boolean(me?.signedIn && me.account);
  // Someone who asked for a recommendation before signing up goes to see it; that page attaches it.
  useEffect(() => {
    if (ready && hasPendingRequests()) router.replace("/my-requests");
  }, [ready, router]);

  if (isLoading || (isAuthenticated && me === undefined)) return <Page><p className="muted">Loading…</p></Page>;
  if (!isAuthenticated || !me?.signedIn) {
    return (
      <Page>
        <h1>Our product catalogue</h1>
        <p className="muted">Create a free account to see our full catalogue and place orders.</p>
        <div className="hero-actions">
          <Link className="button" href="/sign-up">Create an account</Link>
          <Link className="button button-secondary" href="/sign-in">Sign in</Link>
        </div>
      </Page>
    );
  }
  if (!me.account) return <Page signedIn><CompleteAccount /></Page>;
  return <Page signedIn><Shop /></Page>;
}

export default function ShopPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Shop unavailable</h1>
          <p>Please try again later.</p>
        </section>
      </main>
    );
  }
  return <Gate />;
}
