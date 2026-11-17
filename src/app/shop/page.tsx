"use client";

import Link from "next/link";
import { CustomerShell } from "@/components/CustomerShell";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { hasPendingRequests } from "@/lib/pendingRequests";
import { readPendingEstimate } from "@/lib/pendingEstimate";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n";
import { Pager, pageFor } from "@/components/Pager";
import { byPartOrder } from "../../../convex/lib/shopParts";

const CARDS_PER_PAGE = 12;
type Detail = { id: string; imageUrl: string | null; priceMinor: number | null; currency: string | null };

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
  const [brand, setBrand] = useState("");
  const [part, setPart] = useState("");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState({ key: "", page: 1 });
  const [known, setKnown] = useState<Record<string, Detail>>({});

  const parts = useMemo(() => [...new Set((data?.products ?? []).map((p) => p.type))].sort(byPartOrder), [data]);
  // Brands follow the chosen part, so a brand chip never leads to an empty list.
  const brands = useMemo(
    () => [...new Set((data?.products ?? []).filter((p) => !part || p.type === part).map((p) => p.brand))].sort(),
    [data, part]
  );

  // The same item from different brands is one card, with each brand’s price as an option.
  const grouped = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    const map = new Map<string, Map<string, typeof data.products>>();
    for (const p of data.products) {
      if (part && p.type !== part) continue;
      if (brand && p.brand !== brand) continue;
      if (term && !`${p.name} ${p.brand} ${p.model} ${p.description} ${p.category} ${p.type}`.toLowerCase().includes(term)) continue;
      const cards = map.get(p.type) ?? new Map<string, typeof data.products>();
      const key = p.name.trim().toLowerCase();
      cards.set(key, [...(cards.get(key) ?? []), p]);
      map.set(p.type, cards);
    }
    return [...map.entries()]
      .sort(([a], [b]) => byPartOrder(a, b))
      .map(([category, cards]) => [category, [...cards.values()]] as const);
  }, [data, search, brand, part]);

  // Cards are shown a page at a time; prices and photos are fetched for that page and the basket.
  const cards = grouped.flatMap(([category, list]) => list.map((variants) => ({ category, variants })));
  const pageCount = Math.ceil(cards.length / CARDS_PER_PAGE);
  const filterKey = `${search.trim().toLowerCase()}|${part}|${brand}`;
  const page = pageFor(paging, filterKey, pageCount);
  const pageCards = cards.slice((page - 1) * CARDS_PER_PAGE, page * CARDS_PER_PAGE);
  const pageGroups: [string, (typeof cards)[number]["variants"][]][] = [];
  for (const c of pageCards) {
    const last = pageGroups[pageGroups.length - 1];
    if (last && last[0] === c.category) last[1].push(c.variants);
    else pageGroups.push([c.category, [c.variants]]);
  }
  const wanted = [...new Set([...pageCards.flatMap((c) => c.variants.map((p) => p.id as string)), ...Object.keys(cart)])].slice(0, 150);
  const details = useQuery(api.shop.catalogueDetails, data ? { ids: wanted as Id<"products">[] } : "skip");
  if (details && details.some((d) => known[d.id] !== d)) {
    setKnown((k) => ({ ...k, ...Object.fromEntries(details.map((d) => [d.id as string, d])) }));
  }

  if (data === undefined) return <p className="muted">{t("shop.loading")}</p>;

  const byId = new Map(data.products.map((p) => [p.id as string, p]));
  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ id, qty, p: byId.get(id), d: known[id] }))
    .filter((l): l is { id: string; qty: number; p: NonNullable<typeof l.p>; d: Detail } => Boolean(l.p && l.d));
  const total = lines.reduce((sum, l) => sum + (l.d.priceMinor ?? 0) * l.qty, 0);
  const currency = lines[0]?.d.currency ?? "";

  function goTo(next: number) {
    setPaging({ key: filterKey, page: next });
    document.getElementById("shop-search")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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

      {parts.length > 1 ? (
        <div className="quick-row shop-parts" role="group" aria-label={t("shop.part")}>
          <button type="button" className={`chip${part === "" ? " chip-on" : ""}`} aria-pressed={part === ""} onClick={() => { setPart(""); setBrand(""); }}>{t("shop.allParts")}</button>
          {parts.map((x) => (
            <button key={x} type="button" className={`chip${part === x ? " chip-on" : ""}`} aria-pressed={part === x} onClick={() => { setPart(x); setBrand(""); }}>{x}</button>
          ))}
        </div>
      ) : null}

      {brands.length > 1 ? (
        <div className="quick-row shop-brands" role="group" aria-label={t("shop.brand")}>
          <button type="button" className={`chip${brand === "" ? " chip-on" : ""}`} aria-pressed={brand === ""} onClick={() => setBrand("")}>{t("shop.allBrands")}</button>
          {brands.map((b) => (
            <button key={b} type="button" className={`chip${brand === b ? " chip-on" : ""}`} aria-pressed={brand === b} onClick={() => setBrand(b)}>{b}</button>
          ))}
        </div>
      ) : null}

      {grouped.length === 0 ? <p className="muted">{t("shop.none")}</p> : null}
      {pageGroups.map(([category, items]) => (
        <section key={category} className="workspace-section">
          <h2>{category}</h2>
          <div className="shop-grid">
            {items.map((variants) => {
              const first = variants[0];
              const photo = variants.map((v) => known[v.id]?.imageUrl).find(Boolean);
              return (
                <article className="option-card shop-card" key={first.id}>
                  {photo ? <img className="shop-photo" src={photo} alt={first.name} loading="lazy" /> : null}
                  <h3>{first.name}</h3>
                  {variants.length === 1 && first.description ? <p className="hint">{first.description}</p> : null}
                  {variants.length > 1 ? <p className="muted">{t("shop.brandOptions", { count: variants.length })}</p> : null}
                  <ul className="shop-variants">
                    {variants.map((p) => {
                      const d = known[p.id];
                      return (
                      <li key={p.id}>
                        <div>
                          <strong>{p.brand}</strong>
                          <span className="muted">
                            {" "}{p.model}
                            {p.warrantyMonths ? t("shop.warranty", { months: p.warrantyMonths }) : ""}
                          </span>
                          {variants.length > 1 && p.description ? <span className="hint shop-variant-note">{p.description}</span> : null}
                          <p className="stat-value">
                            {!d ? "…" : d.priceMinor !== null && d.currency ? money(d.priceMinor, data.exponent, d.currency) : t("shop.priceOnRequest")}
                          </p>
                        </div>
                        {d && d.priceMinor !== null ? (
                          cart[p.id] ? (
                            <div className="quick-row">
                              <button type="button" className="chip" aria-label={t("shop.fewer", { name: `${p.brand} ${p.name}` })} onClick={() => setCart((c) => { const n = { ...c, [p.id]: c[p.id] - 1 }; if (n[p.id] < 1) delete n[p.id]; return n; })}>−</button>
                              <strong>{cart[p.id]}</strong>
                              <button type="button" className="chip" aria-label={t("shop.more", { name: `${p.brand} ${p.name}` })} onClick={() => setCart((c) => ({ ...c, [p.id]: Math.min(1000, c[p.id] + 1) }))}>+</button>
                            </div>
                          ) : (
                            <button type="button" className="button button-small" onClick={() => { setPlaced(false); setCart((c) => ({ ...c, [p.id]: 1 })); }}>
                              {t("shop.add")}
                            </button>
                          )
                        ) : null}
                      </li>
                      );
                    })}
                  </ul>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <Pager
        page={page}
        pageCount={pageCount}
        onPage={goTo}
        labels={{ previous: t("shop.previous"), next: t("shop.next"), status: (p, n) => t("shop.pageOf", { page: p, pages: n }) }}
      />

      {lines.length > 0 ? (
        <form className="panel-form" onSubmit={submit}>
          <h2>{t("shop.yourOrder")}</h2>
          <ul className="component-list">
            {lines.map((l) => (
              <li key={l.id}>
                <strong>{l.qty} × {l.p.brand} {l.p.name}</strong>
                <span>{money((l.d.priceMinor ?? 0) * l.qty, data.exponent, l.d.currency ?? currency)}</span>
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
    if (ready && (hasPendingRequests() || readPendingEstimate())) router.replace("/my-requests");
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
