"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../convex/_generated/api";
import { BATTERY_PART, ITEM_TYPES, itemTypeByKey, type ItemType } from "../../../convex/lib/itemTypes";
import { PublicShell } from "@/components/PublicShell";
import { SearchSuggest } from "@/components/SearchSuggest";
import { requestReference, WhatsAppSend } from "@/components/WhatsAppSend";
import { Rich, useT, type MessageKey } from "@/lib/i18n";
import { matchesWords, searchWords, type Suggestion } from "@/lib/search";
import { describeItem, specsFromName, type RequestItem } from "./describeItem";

type Draft = {
  type: string;
  subtype: string;
  specs: Record<string, string>;
  description: string;
  productName: string;
  quantity: number;
};

const blankDraft = (type = ""): Draft => ({ type, subtype: "", specs: {}, description: "", productName: "", quantity: 1 });

function message(error: unknown, fallback: string) {
  return error instanceof ConvexError && typeof error.data === "string" ? error.data : fallback;
}

function toItem(d: Draft): RequestItem {
  return {
    type: d.type,
    subtype: d.subtype || undefined,
    specs: Object.entries(d.specs).filter(([, v]) => v.trim()).map(([key, value]) => ({ key, value: value.trim() })),
    description: d.description.trim() || undefined,
    productName: d.productName || undefined,
    quantity: d.quantity
  };
}

const filled = (d: Draft) => Boolean(d.type && (Object.values(d.specs).some((v) => v.trim()) || d.description.trim() || d.productName));

export default function RequestItemPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return null;
  return (
    <PublicShell>
      <RequestItem />
    </PublicShell>
  );
}

function RequestItem() {
  const t = useT();
  const tx = (key: string) => t(key as MessageKey);
  const hints = useQuery(api.itemRequests.publicHints, {});
  const customer = useQuery(api.shop.myAccount, {});
  const submit = useMutation(api.itemRequests.submit);

  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<Draft>(blankDraft());
  // Which list entry the editor is changing, if any.
  const [editing, setEditing] = useState<number | null>(null);
  const [list, setList] = useState<Draft[]>([]);
  const [form, setForm] = useState({ name: "", phone: "", email: "", location: "", note: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | { whatsappText: string | null; phone: string; name: string }>(null);

  const signedIn = customer?.signedIn === true;
  const account = signedIn ? customer.account : null;
  const type = itemTypeByKey(draft.type);
  const products = hints?.open ? hints.products : [];

  // The search box offers kinds of item and the products we sell.
  const suggestions = useMemo<Suggestion[]>(() => [
    ...ITEM_TYPES.map((it) => ({ kind: "category" as const, value: it.key, label: tx(`item.type.${it.key}`), count: 0 })),
    ...products.map((p) => ({ kind: "product" as const, value: p.name, label: p.name, count: p.brands.length }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [products, t]);

  // Products of the chosen kind (and sizes, as they are chosen), to pick from.
  const matching = useMemo(() => {
    if (!type) return [];
    const part = draft.type === "battery" ? BATTERY_PART[draft.subtype] : undefined;
    const sizes = searchWords(Object.entries(draft.specs).filter(([, v]) => v.trim()).map(([k, v]) => `${v}${type.specs.find((f) => f.key === k)?.unit ?? ""}`).join(" "));
    return products
      .filter((p) => type.categoryKeys.includes(p.categoryKey) && (!part || p.part === part))
      .filter((p) => matchesWords(p.name.replace(/(\d)\s+(?=[a-z])/gi, "$1"), sizes))
      .slice(0, 8);
  }, [products, type, draft.type, draft.subtype, draft.specs]);

  function chooseType(t2: ItemType) {
    setDraft((d) => (d.type === t2.key ? d : { ...blankDraft(t2.key), quantity: d.quantity }));
    setError(null);
  }

  function pickProduct(name: string) {
    const p = products.find((x) => x.name === name);
    const it = ITEM_TYPES.find((x) => p && x.categoryKeys.includes(p.categoryKey)) ?? itemTypeByKey("other")!;
    const sub = it.key === "battery" ? Object.entries(BATTERY_PART).find(([, v]) => v === p?.part)?.[0] ?? "" : "";
    setDraft((d) => ({
      ...blankDraft(it.key),
      subtype: d.type === it.key && !sub ? d.subtype : sub,
      specs: specsFromName(name, it),
      productName: name,
      quantity: d.quantity
    }));
    setSearch("");
    setError(null);
  }

  function addToList() {
    if (!filled(draft)) {
      setError(t("item.errNothing"));
      return;
    }
    setList((l) => (editing === null ? [...l, draft] : l.map((x, i) => (i === editing ? draft : x))));
    setDraft(blankDraft());
    setEditing(null);
    setError(null);
    setTimeout(() => document.getElementById("item-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function whatsappMessage(requestId: string, items: RequestItem[]) {
    if (!hints?.open) return null;
    const who = account ?? { name: form.name, phone: form.phone };
    return [
      `Hello ${hints.companyName}, please send me prices for these items:`,
      "",
      ...items.map((it, i) => `${i + 1}. ${describeItem(it)}`),
      "",
      `Name: ${who.name}`,
      `Phone: ${who.phone}`,
      `Location: ${form.location}`,
      form.note.trim() ? `Note: ${form.note.trim()}` : "",
      `Reference: ${requestReference(requestId)}`,
      `Open in the app: ${window.location.origin}/dashboard/item-requests`
    ].filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n");
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    // Something filled in but not yet added counts as part of the request.
    const drafts = filled(draft) ? (editing === null ? [...list, draft] : list.map((x, i) => (i === editing ? draft : x))) : list;
    if (drafts.length === 0) {
      setError(t("item.errEmpty"));
      return;
    }
    const items = drafts.map(toItem);
    setBusy(true);
    setError(null);
    try {
      const sent = await submit({
        items,
        name: account ? undefined : form.name,
        phone: account ? undefined : form.phone,
        email: signedIn ? undefined : form.email || undefined,
        location: form.location,
        note: form.note || undefined,
        website: form.website || undefined
      });
      setDone({
        whatsappText: sent.requestId ? whatsappMessage(sent.requestId, items) : null,
        name: (account?.name ?? form.name).split(" ")[0],
        phone: account?.phone ?? form.phone
      });
      setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
    } catch (e) {
      setError(message(e, t("common.genericError")));
    } finally {
      setBusy(false);
    }
  }

  if (hints === undefined) return <p className="muted">{t("common.loading")}</p>;
  if (!hints.open) return <h1>{t("item.notOpen")}</h1>;

  if (done) {
    return (
      <>
        <h1>{t("item.thanks", { name: done.name })}</h1>
        <p><Rich text={t("item.thanksText", { phone: done.phone })} /></p>
        {hints.whatsappNumber && done.whatsappText ? <WhatsAppSend number={hints.whatsappNumber} text={done.whatsappText} /> : null}
        {hints.contactPhone ? <p className="muted">{t("common.questionsCall", { phone: hints.contactPhone })}</p> : null}
        <div className="hero-actions">
          <button type="button" className="button button-secondary" onClick={() => { setDone(null); setList([]); setDraft(blankDraft()); setForm((f) => ({ ...f, note: "" })); }}>
            {t("item.another")}
          </button>
          <Link className="button button-secondary" href="/">{t("estimate.backHome")}</Link>
        </div>
      </>
    );
  }

  const firstEmpty = account
    ? (form.location.trim() ? "" : "location")
    : !form.name.trim() ? "name" : !form.phone.trim() ? "phone" : !form.location.trim() ? "location" : "";
  const glowIf = (field: string) => (firstEmpty === field ? "guide-glow" : undefined);

  return (
    <>
      <p className="eyebrow">{hints.companyName.toUpperCase()}</p>
      <h1>{t("item.title")}</h1>
      <p className="muted">{t("item.intro")}</p>

      <section className="panel-form item-request">
        <SearchSuggest
          id="item-search"
          className="shop-search"
          label={t("item.search")}
          placeholder={t("item.searchPlaceholder")}
          value={search}
          onChange={setSearch}
          suggestions={suggestions}
          kindLabels={{ category: t("shop.kind.category"), brand: t("shop.kind.brand"), supplier: "", product: t("shop.kind.product") }}
          onPick={(s) => {
            if (s.kind === "category") { chooseType(itemTypeByKey(s.value)!); setSearch(""); }
            else pickProduct(s.value);
          }}
        />

        <h2 className="item-step-title">{t("item.kindTitle")}</h2>
        <div className={`item-kinds${!draft.type && list.length === 0 ? " guide-glow" : ""}`} role="radiogroup" aria-label={t("item.kindTitle")}>
          {ITEM_TYPES.map((it) => (
            <button key={it.key} type="button" role="radio" aria-checked={draft.type === it.key} className={`pick${draft.type === it.key ? " pick-on" : ""}`} onClick={() => chooseType(it)}>
              <span className="pick-emoji" aria-hidden="true">{it.emoji}</span>
              <span className="pick-name">{tx(`item.type.${it.key}`)}</span>
            </button>
          ))}
        </div>

        {type ? (
          <div className="item-editor">
            {draft.productName ? (
              <p className="form-success">
                {t("item.chosen", { name: draft.productName })}{" "}
                <button type="button" className="link-button" onClick={() => setDraft((d) => ({ ...d, productName: "" }))}>{t("item.change")}</button>
              </p>
            ) : null}

            {type.subtypes.length ? (
              <>
                <p className="field-label">{t("item.subTitle")}</p>
                <div className="quick-row" role="radiogroup" aria-label={t("item.subTitle")}>
                  {type.subtypes.map((s) => (
                    <button key={s} type="button" role="radio" aria-checked={draft.subtype === s} className={`chip${draft.subtype === s ? " chip-on" : ""}`}
                      onClick={() => setDraft((d) => ({ ...d, subtype: d.subtype === s ? "" : s, productName: "" }))}>
                      {tx(`item.sub.${s}`)}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {type.specs.map((field) => {
              const value = draft.specs[field.key] ?? "";
              const id = `spec-${field.key}`;
              return (
                <div key={field.key} className="item-spec">
                  <label htmlFor={id} className="field-label">{tx(`item.spec.${field.key}`)} ({field.unit})</label>
                  <div className="quick-row" role="group" aria-label={tx(`item.spec.${field.key}`)}>
                    {field.options.map((o) => (
                      <button key={o} type="button" aria-pressed={value === o} className={`chip${value === o ? " chip-on" : ""}`}
                        onClick={() => setDraft((d) => ({ ...d, specs: { ...d.specs, [field.key]: d.specs[field.key] === o ? "" : o }, productName: "" }))}>
                        {o} {field.unit}
                      </button>
                    ))}
                  </div>
                  <div className="item-spec-typed">
                    <input id={id} inputMode="decimal" maxLength={20} placeholder={`${t("item.orType")}: ${field.options[Math.min(2, field.options.length - 1)]}`} value={value}
                      onChange={(e) => setDraft((d) => ({ ...d, specs: { ...d.specs, [field.key]: e.target.value }, productName: "" }))} />
                    <span className="upgrade-unit">{field.unit}</span>
                  </div>
                </div>
              );
            })}

            {matching.length && !draft.productName ? (
              <div className="item-matches">
                <p className="field-label">{t("item.weSell")}</p>
                <div className="quick-row">
                  {matching.map((p) => (
                    <button key={p.name} type="button" className="chip" onClick={() => pickProduct(p.name)}>{p.name}</button>
                  ))}
                </div>
              </div>
            ) : null}

            <label htmlFor="item-describe">{t("item.describe")}</label>
            <input id="item-describe" maxLength={300} placeholder={t("item.describePlaceholder")} value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} />

            <p className="field-label">{t("item.quantity")}</p>
            <div className="item-qty">
              <button type="button" className="chip" aria-label={t("item.fewer")} onClick={() => setDraft((d) => ({ ...d, quantity: Math.max(1, d.quantity - 1) }))}>−</button>
              <input aria-label={t("item.quantity")} inputMode="numeric" value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: Math.min(1000, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)) }))} />
              <button type="button" className="chip" aria-label={t("item.more")} onClick={() => setDraft((d) => ({ ...d, quantity: Math.min(1000, d.quantity + 1) }))}>+</button>
            </div>

            {error && list.length === 0 ? <p className="auth-message" role="alert">{error}</p> : null}
            <button type="button" className={`button${filled(draft) ? " guide-glow" : ""}`} onClick={addToList}>
              {editing === null ? `＋ ${t("item.add")}` : t("item.update")}
            </button>
          </div>
        ) : null}
      </section>

      {list.length ? (
        <form id="item-list" className="panel-form" onSubmit={send}>
          <h2>{t("item.listTitle")} ({list.length})</h2>
          <ul className="component-list">
            {list.map((d, i) => (
              <li key={i}>
                <strong>{describeItem(toItem(d), tx)}</strong>
                <span>
                  <button type="button" className="link-button" onClick={() => { setDraft(d); setEditing(i); window.scrollTo({ top: 0, behavior: "smooth" }); }}>{t("item.edit")}</button>{" · "}
                  <button type="button" className="link-button" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>{t("item.remove")}</button>
                </span>
              </li>
            ))}
          </ul>

          <h3>{t("item.contactTitle")}</h3>
          {account ? (
            <div className="signed-in-request">
              <strong>{t("estimate.requestingAs", { name: account.name })}</strong>
            </div>
          ) : (
            <>
              {signedIn ? <p className="hint">{t("estimate.signedInNoAccount")}</p> : null}
              <label htmlFor="ir-name">{t("estimate.yourName")}</label>
              <input id="ir-name" className={glowIf("name")} required maxLength={100} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <label htmlFor="ir-phone">{t("estimate.phone")}</label>
              <input id="ir-phone" className={glowIf("phone")} required type="tel" maxLength={20} autoComplete="tel" placeholder="+256 700 000000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              {signedIn ? null : (
                <>
                  <label htmlFor="ir-email">{t("estimate.emailOptional")}</label>
                  <input id="ir-email" type="email" maxLength={120} autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </>
              )}
            </>
          )}
          <label htmlFor="ir-loc">{t("item.location")}</label>
          <input id="ir-loc" className={glowIf("location")} required maxLength={200} autoComplete="address-level2" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <label htmlFor="ir-note">{t("shop.note")}</label>
          <input id="ir-note" maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="honeypot" aria-hidden="true">
            <label htmlFor="ir-site">Website</label>
            <input id="ir-site" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} />
          </div>
          {error ? <p className="auth-message" role="alert">{error}</p> : null}
          <button className={`button${firstEmpty || filled(draft) ? "" : " guide-glow"}`} type="submit" disabled={busy || customer === undefined}>
            {busy ? t("item.sending") : t("item.send")}
          </button>
        </form>
      ) : null}
    </>
  );
}
