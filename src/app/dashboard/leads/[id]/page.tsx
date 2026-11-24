"use client";

import Link from "next/link";
import { useRecordReply, WhatsappFollowUp } from "@/components/WhatsappFollowUp";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import { shrinkImage } from "@/lib/shrinkImage";
import { describeNeeds, describeSystem } from "../../../estimate/upgrade/describe";
import { UpgradeReport } from "../../../estimate/upgrade/UpgradeReport";
import { SearchSuggest } from "@/components/SearchSuggest";
import type { Suggestion } from "@/lib/search";
import { AppUpdateNeeded, savePdf } from "@/lib/savePdf";
import { sharePdf } from "@/lib/sharePdf";
import { whatsappDigits } from "@/lib/whatsapp";
import { requestReference } from "@/components/WhatsAppSend";
import type { PdfOption } from "./recommendationPdf";

type Lead = FunctionReturnType<typeof api.responses.getLead>;
type EditOption = {
  key: string;
  title: string;
  description: string;
  /** productId is set when the part was picked from the catalogue. */
  components: { name: string; quantity: string; productId?: Id<"products"> }[];
  price: string;
};

const GRID = { none: "No grid power", unreliable: "Grid often goes off", reliable: "Grid mostly reliable" } as const;
const CATEGORY = {
  residential: "🏠 Home",
  commercial_small: "🏪 Small business",
  commercial_medium: "🏨 Medium business",
  industrial: "🏭 Industry"
} as const;
const SYSTEM = { off_grid: "Off-grid", hybrid: "Hybrid", grid_tied: "Grid-tied", backup_only: "Backup only" } as const;
const QUICK_PARTS = ["Solar panel", "Hybrid inverter", "Lithium battery", "Charge controller", "Mounting and cabling", "Installation"];

const newKey = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
const blankOption = (n: number): EditOption => ({
  key: newKey(),
  title: n === 0 ? "Recommended system" : `Option ${n + 1}`,
  description: "",
  components: [],
  price: ""
});

/** A clearly labelled box for a part the company sources from outside its catalogue. */
function OutsidePart({ optionKey, onAdd }: { optionKey: string; onAdd: (name: string, quantity: string) => void }) {
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  function add() {
    if (!name.trim()) return;
    onAdd(name.trim(), quantity || "1");
    setName("");
    setQuantity("1");
  }
  return (
    <div className="outside-part">
      <label htmlFor={`op-${optionKey}`}>Part name</label>
      <div className="outside-part-row">
        <input
          id={`op-${optionKey}`}
          maxLength={100}
          placeholder="Type the part, e.g. 6 mm² solar cable, 30 m"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
        />
        <input aria-label="How many" className="part-qty" inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} />
        <button type="button" className="button button-small" disabled={!name.trim()} onClick={add}>+ Add part</button>
      </div>
    </div>
  );
}

function money(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}
const kw = (w: number) => (w >= 1000 ? `${(w / 1000).toFixed(w >= 10_000 ? 0 : 1)} kW` : `${Math.round(w)} W`);

/** Search box over the company catalogue; tapping a product adds it to the option as a part. */
function CataloguePicker({ leadId, onPick, onClose, currency, exponent }: {
  leadId: Id<"quoteRequests">;
  onPick: (p: { id: Id<"products">; label: string }) => void;
  onClose: () => void;
  currency: string;
  exponent: number;
}) {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  const names = useQuery(api.responses.catalogueNames, { leadId });
  const suggestions: Suggestion[] = names
    ? [
        ...names.categories.map((c) => ({ kind: "category" as const, value: c.id, label: c.name, count: c.count })),
        ...names.brands.map((b) => ({ kind: "brand" as const, value: b.value, label: b.value, count: b.count })),
        ...names.names.map((n) => ({ kind: "product" as const, value: n.value, label: n.value, count: n.count }))
      ]
    : [];
  // Wait for a pause in typing before searching.
  useEffect(() => {
    const id = setTimeout(() => setQuery(term), 250);
    return () => clearTimeout(id);
  }, [term]);
  const found = useQuery(api.responses.searchCatalogue, {
    leadId,
    term: query,
    categoryId: categoryId ? (categoryId as Id<"productCategories">) : undefined
  });

  return (
    <div className="catalogue-picker">
      <div className="filter-row">
        <SearchSuggest
          id={`cp-${leadId}`}
          label="Search the catalogue"
          autoFocus
          placeholder="Type, e.g. solar, battery 48V, Deye 5kW"
          value={term}
          onChange={setTerm}
          suggestions={suggestions}
          kindLabels={{ category: "Category", brand: "Brand", supplier: "Supplier", product: "Product" }}
          onPick={(s) => {
            // A category narrows the list to it; a brand or product name searches for it.
            if (s.kind === "category") { setCategoryId(s.value); setTerm(""); }
            else setTerm(s.value);
          }}
        />
        <select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">All categories</option>
          {(found?.categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" className="button button-secondary button-small" onClick={onClose}>Done</button>
      </div>
      {found === undefined ? <p className="muted">Searching…</p> : found.results.length === 0 ? (
        <p className="muted">Nothing in the catalogue matches. Type the part below instead.</p>
      ) : (
        <>
          <ul className="catalogue-results">
            {found.results.map((p) => {
              const label = `${p.brand} ${p.name}${p.model && !p.name.includes(p.model) ? ` (${p.model})` : ""}`.slice(0, 100);
              const count = added.filter((x) => x === p.id).length;
              return (
                <li key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <span className="record-meta">{p.brand} {p.model} · {p.categoryName}</span>
                  </div>
                  <span className="catalogue-price">{p.listPriceMinor !== null ? money(p.listPriceMinor, exponent, currency) : "No price yet"}</span>
                  <button type="button" className="button button-small" onClick={() => { onPick({ id: p.id, label }); setAdded((a) => [...a, p.id]); }}>
                    {count ? `Added ${count} · add again` : "+ Add"}
                  </button>
                </li>
              );
            })}
          </ul>
          {found.total > found.results.length ? <p className="hint">Showing {found.results.length} of {found.total}. Type more words to narrow it down.</p> : null}
        </>
      )}
    </div>
  );
}

/**
 * Rules of thumb so a technician starts from sensible sizes. They are a starting point, not a design:
 * about 4.5 useful sun hours a day in Uganda, 75% system efficiency, batteries used to 80%.
 */
function sizingGuide(lead: Lead) {
  const pvKw = lead.dailyKwh / (4.5 * 0.75);
  const panels = Math.max(1, Math.ceil((pvKw * 1000) / 550));
  const storeKwh =
    lead.gridAvailability === "none"
      ? lead.dailyKwh
      : lead.gridAvailability === "unreliable"
        ? Math.max(lead.load.nightKwh, lead.dailyKwh * 0.5)
        : lead.load.nightKwh * 0.5;
  const batteryKwh = storeKwh / 0.8;
  const inverterKw = Math.max(1, (lead.load.peakW * 1.25) / 1000);
  return { pvKw, panels, batteryKwh, inverterKw, surgeKw: lead.load.peakWithSurgeW / 1000 };
}

function Specs({ lead }: { lead: Lead }) {
  const guide = sizingGuide(lead);
  const recordReply = useRecordReply();
  const phoneDigits = lead.phone.replace(/[^\d+]/g, "");
  const whatsapp = phoneDigits.replace(/^\+/, "").replace(/^0/, "256");
  return (
    <>
      <section className="lead-block lead-contact">
        <h2>{lead.name}</h2>
        <p className="muted">{lead.location} · sent {new Date(lead.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · reference <strong>{requestReference(lead.id)}</strong></p>
        <div className="lead-contact-actions">
          <a className="button button-small" href={`tel:${phoneDigits}`}>📞 Call {lead.phone}</a>
          <a className="button button-small button-secondary" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" onClick={() => { if (!lead.whatsapp.repliedAt) recordReply({ quoteRequestId: lead.id }); }}>WhatsApp</a>
          {lead.email ? <a className="button button-small button-secondary" href={`mailto:${lead.email}`}>Email</a> : null}
        </div>
        <WhatsappFollowUp tracking={lead.whatsapp} quoteRequestId={lead.id} />
        <p className={lead.hasAccount ? "lead-reach lead-reach-ok" : "lead-reach"}>
          {lead.hasAccount
            ? "Has a Solar Switch account: what you send appears in their app."
            : "No account yet. They were asked to sign up to receive the recommendation in the app. Call or WhatsApp them as well."}
        </p>
      </section>

      {lead.budget ? <BudgetSpecs lead={lead} budget={lead.budget} /> : null}

      {lead.isUpgrade ? <UpgradeSpecs lead={lead} /> : (
      <>
      <section className="lead-block">
        <h2>What they need</h2>
        <div className="lead-tiles">
          <div className="lead-tile tile-energy"><span>Energy</span><strong>{lead.dailyKwh} kWh</strong><small>per day</small></div>
          <div className="lead-tile tile-peak"><span>Busiest moment</span><strong>{kw(lead.load.peakW)}</strong><small>{kw(lead.load.peakWithSurgeW)} with motor starts</small></div>
          <div className="lead-tile tile-day"><span>Day / night</span><strong>{lead.load.dayKwh} / {lead.load.nightKwh}</strong><small>kWh, 6am–6pm / night</small></div>
          <div className="lead-tile tile-month">
            <span>Spends now</span>
            <strong>{lead.costPerMonthMinor !== null ? money(lead.costPerMonthMinor, lead.exponent, lead.currency) : "—"}</strong>
            <small>per month on grid power</small>
          </div>
        </div>
        <dl className="lead-facts">
          <div><dt>Where</dt><dd>{lead.category ? CATEGORY[lead.category] : "Not given"}</dd></div>
          <div><dt>Grid</dt><dd>{GRID[lead.gridAvailability]}</dd></div>
          <div><dt>Worked out from</dt><dd>{lead.inputMode === "appliances" ? "Their appliance list" : "Their UEDCL token messages"}</dd></div>
          <div><dt>Asked for</dt><dd>{lead.isRecommendation ? "A system recommendation and quotation" : lead.optionTitle}</dd></div>
          <div><dt>Suggested type</dt><dd>{SYSTEM[lead.systemType]}{lead.backupHours ? `, ${lead.backupHours} h backup` : ""}{lead.autonomyDays ? `, ${lead.autonomyDays} day(s) autonomy` : ""}</dd></div>
        </dl>
      </section>

      <section className="lead-block">
        <h2>Appliances ({lead.appliances.length})</h2>
        {lead.appliances.length === 0 ? (
          <p className="muted">They used token messages only, so there is no appliance list. Call them to ask what they run.</p>
        ) : (
          <ul className="lead-appliances">
            {lead.appliances.map((a, i) => (
              <li key={i}>
                <strong>{a.quantity} × {a.name}</strong>
                <span>{a.powerW} W each · {a.hoursPerDay} h/day{a.duty < 1 ? ` · runs ${Math.round(a.duty * 100)}% of the time` : ""}</span>
                <span className="lead-kwh">{a.kwhPerDay} kWh/day</span>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Hours and watts are the customer&apos;s own estimates. Check them on the call or site visit.</p>
      </section>

      <section className="lead-block lead-guide">
        <h2>Rough sizing guide</h2>
        <ul>
          <li><strong>Solar:</strong> about {guide.pvKw.toFixed(1)} kWp, roughly {guide.panels} × 550 W panels</li>
          <li><strong>Battery:</strong> about {guide.batteryKwh.toFixed(1)} kWh usable storage{lead.gridAvailability === "none" ? " (one full day)" : lead.gridAvailability === "unreliable" ? " (nights and outages)" : " (short backup)"}</li>
          <li><strong>Inverter:</strong> at least {guide.inverterKw.toFixed(1)} kW continuous, able to start {guide.surgeKw.toFixed(1)} kW</li>
        </ul>
        <p className="hint">Rule of thumb only: 4.5 sun hours, 75% efficiency, batteries used to 80%. Confirm on site before quoting.</p>
      </section>
      </>
      )}
    </>
  );
}

/** "What can my money buy?": the budget, the system they chose, and how today's prices compare. */
function BudgetSpecs({ lead, budget }: { lead: Lead; budget: NonNullable<Lead["budget"]> }) {
  const total = budget.equipmentMinor;
  const diff = total === null ? null : budget.amountMinor - total;
  return (
    <section className="lead-block lead-budget">
      <h2>💰 Budget: {money(budget.amountMinor, lead.exponent, lead.currency)}</h2>
      <p className="hint">For the main equipment only (inverter, batteries, panels). Installation is not included. The customer was shown no prices.</p>
      {lead.components.length ? (
        <>
          <p><strong>Chose:</strong> {lead.optionTitle}</p>
          <ul className="lead-appliances">
            {lead.components.map((c, i) => (
              <li key={i}>
                <strong>{c.quantity} × {c.role}</strong>
                <span>{[c.brand, c.model ?? c.name].filter(Boolean).join(" ")}{c.detail ? ` · ${c.detail}` : ""}{c.estimated ? " (specs estimated — verify)" : ""}</span>
              </li>
            ))}
          </ul>
          {budget.leavesOut.length ? <p className="lead-budget-out">Leaves out to fit the budget: {budget.leavesOut.join(", ")}</p> : null}
          {total === null ? (
            <p className="lead-budget-note">One of these parts has no list price today. Price it before you respond.</p>
          ) : (
            <p className={diff! >= 0 ? "lead-budget-note lead-budget-ok" : "lead-budget-note lead-budget-over"}>
              Equipment at today&apos;s list prices: <strong>{money(total, lead.exponent, lead.currency)}</strong>{" "}
              {diff! >= 0 ? `(${money(diff!, lead.exponent, lead.currency)} within the budget)` : `(${money(-diff!, lead.exponent, lead.currency)} above the budget)`}
            </p>
          )}
        </>
      ) : (
        <p className="lead-budget-note">They did not choose a system: advise what this budget can buy for the appliances below.</p>
      )}
    </section>
  );
}

/** A request to upgrade an existing system: what they described, and what the upgrade check makes of it. */
function UpgradeSpecs({ lead }: { lead: Lead }) {
  const study = useQuery(api.upgrades.forLead, { leadId: lead.id });
  return (
    <>
      <section className="lead-block">
        <h2>Their existing system</h2>
        {study === undefined ? <p className="muted">Loading…</p> : null}
        {study ? (
          <ul className="upgrade-summary">
            {[...describeSystem(study.system), ...describeNeeds(study.needs)].map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}
        <dl className="lead-facts">
          <div><dt>Grid</dt><dd>{GRID[lead.gridAvailability]}</dd></div>
          <div>
            <dt>Asked about</dt>
            <dd>{lead.components.length ? lead.components.map((c) => `${c.quantity} × ${c.name}${c.estimated ? " (specs estimated — verify)" : ""}`).join(", ") : "A recommendation"}</dd>
          </div>
        </dl>
        <p className="hint">
          These ratings are the customer&apos;s own and have not been inspected. Check the nameplates on a call or site visit before quoting.
        </p>
        {lead.upgradeStudyId ? (
          <Link className="button button-small" href={`/dashboard/upgrades/${lead.upgradeStudyId}`}>Open the upgrade study</Link>
        ) : (
          <p className="hint">Convert this request from the request list to save it as an upgrade study and build a quotation.</p>
        )}
      </section>
      {study ? (
        <section className="estimate-results">
          <UpgradeReport report={study.report} />
        </section>
      ) : null}
    </>
  );
}

function ResponseEditor({ lead }: { lead: Lead }) {
  const save = useMutation(api.responses.saveResponse);
  const uploadUrl = useMutation(api.responses.generateImageUploadUrl);
  const attach = useAction(api.responses.attachImage);
  const removeImage = useMutation(api.responses.removeImage);
  const existing = lead.response;
  const [message, setMessage] = useState(existing?.message ?? `Hello ${lead.name.split(" ")[0]}, thank you for using the Solar Switch power check. Based on your needs, here is what we recommend.`);
  const [options, setOptions] = useState<EditOption[]>(
    existing?.options.length
      ? existing.options.map((o) => ({
          key: o.key,
          title: o.title,
          description: o.description,
          components: o.components.map((c) => ({ name: c.name, quantity: String(c.quantity), productId: c.productId ?? undefined })),
          price: o.priceMinor !== null ? String(o.priceMinor / 10 ** lead.exponent) : ""
        }))
      : [blankOption(0)]
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // Which option has the catalogue search open.
  const [picking, setPicking] = useState<string | null>(null);
  const linked = [...new Set(options.flatMap((o) => o.components.map((c) => c.productId).filter((id): id is Id<"products"> => Boolean(id))))];
  const partPrices = useQuery(api.responses.catalogueParts, linked.length ? { leadId: lead.id, ids: linked } : "skip");
  /** List-price total of an option's catalogue parts, and whether any part has no price. */
  function catalogueTotal(o: EditOption) {
    let total = 0;
    let parts = 0;
    let unpriced = 0;
    for (const c of o.components) {
      if (!c.productId) continue;
      parts++;
      const unit = partPrices?.[c.productId];
      if (unit === null || unit === undefined) unpriced++;
      else total += unit * (Number(c.quantity) || 0);
    }
    return { total, parts, unpriced };
  }
  const images = new Map((existing?.options ?? []).map((o) => [o.key, o.images]));
  const sent = existing?.status === "sent";

  const update = (i: number, patch: Partial<EditOption>) => setOptions((all) => all.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  function payload() {
    return options.map((o) => ({
      key: o.key,
      title: o.title,
      description: o.description,
      components: o.components
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name, quantity: Number(c.quantity), ...(c.productId ? { productId: c.productId } : {}) })),
      price: o.price.trim() ? Number(o.price.replace(/[,\s]/g, "")) : undefined
    }));
  }

  async function submit(send: boolean) {
    if (send && !window.confirm(sent ? "Update what the customer sees?" : "Send this recommendation to the customer?")) return;
    setBusy(send ? "send" : "save");
    setNotice(null);
    try {
      await save({ leadId: lead.id, message, options: payload(), send });
      setNotice({
        ok: true,
        text: send
          ? lead.hasAccount
            ? "Sent. The customer sees it in their app."
            : "Sent. It will appear in their app once they sign up. Let them know by phone or WhatsApp."
          : "Draft saved. The customer cannot see it yet."
      });
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  async function addPhotos(optionKey: string, files: File[]) {
    if (!files.length) return;
    setBusy(`photo-${optionKey}`);
    setNotice(null);
    try {
      // Photos belong to an option that must exist on the server, so save the draft first.
      if (!sent) await save({ leadId: lead.id, message, options: payload(), send: false });
      for (const file of files.slice(0, 4)) {
        const blob = await shrinkImage(file);
        const url = await uploadUrl({ leadId: lead.id });
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
        if (!res.ok) throw new Error("upload");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await attach({ leadId: lead.id, optionKey, storageId });
      }
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error && e.message === "upload" ? "The photo did not upload. Check your connection." : errorMessage(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="lead-block lead-response">
      <h2>{sent ? "Your recommendation (sent)" : "Prepare a recommendation"}</h2>
      {existing?.chosenOptionKey ? (
        <p className="form-success">
          The customer chose <strong>{existing.options.find((o) => o.key === existing.chosenOptionKey)?.title ?? "an option"}</strong>. Call them to arrange a site visit.
        </p>
      ) : null}
      {existing?.preparedBy ? <p className="hint">Last saved by {existing.preparedBy}{existing.sentAt ? `, sent ${new Date(existing.sentAt).toLocaleDateString("en-GB")}` : ""}.</p> : null}

      <label htmlFor="rs-message">Message to the customer</label>
      <textarea id="rs-message" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />

      {options.map((o, i) => (
        <fieldset key={o.key} className="response-option">
          <legend>Option {i + 1}</legend>
          <label htmlFor={`t-${o.key}`}>Title</label>
          <input id={`t-${o.key}`} maxLength={100} placeholder="e.g. 3 kVA hybrid with 5 kWh battery" value={o.title} onChange={(e) => update(i, { title: e.target.value })} />
          <label htmlFor={`d-${o.key}`}>What it powers and for how long</label>
          <textarea id={`d-${o.key}`} rows={3} maxLength={1000} placeholder="e.g. Runs the fridge, TV and lights day and night, with about 8 hours of backup during outages." value={o.description} onChange={(e) => update(i, { description: e.target.value })} />

          <span className="response-label">Main parts</span>
          {o.components.length === 0 ? <p className="hint">No parts yet. Add them from the catalogue or type them below.</p> : null}
          {o.components.map((c, ci) => (
            <div key={ci} className="part-row">
              <input aria-label="Quantity" inputMode="numeric" className="part-qty" value={c.quantity} onChange={(e) => update(i, { components: o.components.map((x, xi) => (xi === ci ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)) })} />
              <span aria-hidden="true">×</span>
              {c.productId ? (
                <span className="part-linked" title="From the catalogue">
                  <span className="pill">Catalogue</span> {c.name}
                  {partPrices?.[c.productId] != null ? <span className="record-meta"> · {money(partPrices[c.productId]!, lead.exponent, lead.currency)} each</span> : null}
                </span>
              ) : (
                <input aria-label="Part" maxLength={100} placeholder="e.g. 550 W solar panel" value={c.name} onChange={(e) => update(i, { components: o.components.map((x, xi) => (xi === ci ? { ...x, name: e.target.value } : x)) })} />
              )}
              <button type="button" className="part-remove" aria-label={`Remove ${c.name || "part"}`} onClick={() => update(i, { components: o.components.filter((_, xi) => xi !== ci) })}>✕</button>
            </div>
          ))}
          <div className="part-source part-source-catalogue">
            <p className="part-source-title">From the catalogue</p>
          {picking === o.key ? (
            <CataloguePicker
              leadId={lead.id}
              currency={lead.currency}
              exponent={lead.exponent}
              onClose={() => setPicking(null)}
              onPick={(p) => update(i, { components: [...o.components.filter((c) => c.name.trim()), { name: p.label, quantity: "1", productId: p.id }] })}
            />
          ) : (
            <button type="button" className="button button-secondary button-small" onClick={() => setPicking(o.key)}>🔎 Search the catalogue</button>
          )}
          </div>
          <div className="part-source part-source-outside">
            <p className="part-source-title">Not in the catalogue? Type it here</p>
            <OutsidePart optionKey={o.key} onAdd={(name, quantity) => update(i, { components: [...o.components.filter((c) => c.name.trim()), { name, quantity }] })} />
            <p className="hint">Or tap a common part:</p>
          <div className="quick-parts">
            {QUICK_PARTS.map((p) => (
              <button type="button" key={p} className="chip" onClick={() => update(i, { components: [...o.components.filter((c) => c.name.trim()), { name: p, quantity: "1" }] })}>+ {p}</button>
            ))}
          </div>
          </div>

          {(() => {
            const ct = catalogueTotal(o);
            if (!ct.parts) return null;
            return (
              <p className="hint catalogue-total">
                Catalogue parts at list price: <strong>{money(ct.total, lead.exponent, lead.currency)}</strong>
                {ct.unpriced ? ` (${ct.unpriced} part${ct.unpriced === 1 ? " has" : "s have"} no price yet)` : ""}. Add installation and other parts on top.{" "}
                {ct.total > 0 ? (
                  <button type="button" className="link-button" onClick={() => update(i, { price: String(ct.total / 10 ** lead.exponent) })}>Use as the price</button>
                ) : null}
              </p>
            );
          })()}
          <label htmlFor={`p-${o.key}`}>Estimated price, {lead.currency} (optional)</label>
          <input id={`p-${o.key}`} inputMode="numeric" placeholder="Leave empty to discuss the price" value={o.price} onChange={(e) => update(i, { price: e.target.value.replace(/[^\d,]/g, "") })} />

          <span className="response-label">Photos</span>
          <div className="response-photos">
            {(images.get(o.key) ?? []).map((img) => (
              <div key={img.id} className="response-photo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={img.url} alt="" />
                <button type="button" aria-label="Remove photo" onClick={() => void removeImage({ imageId: img.id as Id<"responseImages"> })}>✕</button>
              </div>
            ))}
            {(images.get(o.key)?.length ?? 0) < 4 ? (
              <label className="photo-add">
                <input type="file" accept="image/*" multiple className="visually-hidden" disabled={busy !== null} onChange={(e) => {
                    // Copy the chosen files before clearing the picker, which empties its list.
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = "";
                    void addPhotos(o.key, picked);
                  }} />
                {busy === `photo-${o.key}` ? "Uploading…" : "📷 Add photos"}
              </label>
            ) : null}
          </div>

          {options.length > 1 ? (
            <button type="button" className="link-danger" onClick={() => setOptions((all) => all.filter((_, j) => j !== i))}>Remove this option</button>
          ) : null}
        </fieldset>
      ))}
      {options.length < 3 ? (
        <button type="button" className="button button-secondary" onClick={() => setOptions((all) => [...all, blankOption(all.length)])}>+ Add another option</button>
      ) : null}

      {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
      <div className="response-actions">
        {!sent ? (
          <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => submit(false)}>
            {busy === "save" ? "Saving…" : "Save draft"}
          </button>
        ) : null}
        <button type="button" className="button" disabled={busy !== null} onClick={() => submit(true)}>
          {busy === "send" ? "Sending…" : sent ? "Update what the customer sees" : "Send to customer"}
        </button>
      </div>
      <ShareRecommendation
        lead={lead}
        message={message}
        preparedBy={existing?.preparedBy ?? null}
        options={options.map((o) => ({
          title: o.title,
          description: o.description,
          parts: o.components.filter((c) => c.name.trim()).map((c) => ({ name: c.name, quantity: Number(c.quantity) || 1 })),
          price: o.price.trim() ? money(Number(o.price.replace(/[,\s]/g, "")) * 10 ** lead.exponent, lead.exponent, lead.currency) : null,
          photoUrls: (images.get(o.key) ?? []).map((i) => i.url)
        }))}
      />
    </section>
  );
}

/**
 * Download the recommendation as a PDF, or share it straight to the customer on WhatsApp.
 * Built from what is on screen, so it matches the editor even before saving.
 */
function ShareRecommendation({ lead, message, options, preparedBy }: { lead: Lead; message: string; options: PdfOption[]; preparedBy: string | null }) {
  const [busy, setBusy] = useState<"pdf" | "share" | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const customerWhatsapp = whatsappDigits(lead.phone);
  const reference = requestReference(lead.id);
  const filename = `solar-recommendation-${lead.name.split(" ")[0].toLowerCase().replace(/[^a-z0-9]+/g, "") || "customer"}-${reference}.pdf`;

  async function build() {
    const { buildRecommendationPdf } = await import("./recommendationPdf");
    return await buildRecommendationPdf({
      companyName: lead.companyName,
      customerName: lead.name,
      location: lead.location,
      phone: lead.phone,
      reference,
      preparedBy,
      needs: lead.isUpgrade || !lead.dailyKwh ? null : `about ${lead.dailyKwh} kWh a day, busiest moment about ${kw(lead.load.peakW)}`,
      message,
      options
    });
  }

  async function run(kind: "pdf" | "share") {
    if (!options.some((o) => o.title.trim())) {
      setNotice({ ok: false, text: "Add at least one option before making the PDF." });
      return;
    }
    setBusy(kind);
    setNotice(null);
    try {
      const bytes = await build();
      if (kind === "pdf") {
        await savePdf(bytes, filename, "Solar recommendation");
        setNotice({ ok: true, text: "PDF ready." });
      } else {
        const outcome = await sharePdf(bytes, filename, "Solar recommendation", {
          to: customerWhatsapp,
          text: `Hello ${lead.name.split(" ")[0]}, here is your solar recommendation from ${lead.companyName} (reference ${reference}).`
        });
        setNotice(
          outcome === "downloaded"
            ? { ok: true, text: customerWhatsapp ? "The PDF downloaded and WhatsApp opened to the customer's chat. Attach the PDF there and send." : "The PDF downloaded. The customer's phone number does not work for WhatsApp, so send it to them yourself." }
            : outcome === "shared" ? { ok: true, text: "Choose WhatsApp and the customer's chat to send it." } : null
        );
      }
    } catch (e) {
      setNotice({ ok: false, text: e instanceof AppUpdateNeeded ? e.message : "The PDF could not be made. Please try again." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="share-recommendation">
      <span className="response-label">Share with the customer</span>
      <div className="response-actions">
        <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => run("pdf")}>
          {busy === "pdf" ? "Making the PDF…" : "⬇ Download recommendation (PDF)"}
        </button>
        <button type="button" className="button button-whatsapp" disabled={busy !== null} onClick={() => run("share")}>
          {busy === "share" ? "Making the PDF…" : "💬 Share PDF on WhatsApp"}
        </button>
      </div>
      <p className="hint">The PDF shows the message, each option with its parts, estimated price and photos. Customer: {lead.phone}.</p>
      {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
    </div>
  );
}

function ReadOnlyResponse({ lead }: { lead: Lead }) {
  const r = lead.response;
  return (
    <section className="lead-block">
      <h2>Recommendation</h2>
      {!r ? <p className="muted">A technician has not responded yet.</p> : (
        <>
          <p className="hint">{r.status === "sent" ? "Sent to the customer." : "Draft, not sent yet."}</p>
          <p>{r.message}</p>
          {r.options.map((o) => (
            <div key={o.key} className="response-option">
              <strong>{o.title}{r.chosenOptionKey === o.key ? " ✅ chosen by the customer" : ""}</strong>
              <p className="muted">{o.description}</p>
              <p className="muted">{o.components.map((c) => `${c.quantity} × ${c.name}`).join(", ")}</p>
              {o.priceMinor !== null ? <p><strong>{money(o.priceMinor, lead.exponent, lead.currency)}</strong></p> : null}
            </div>
          ))}
          <ShareRecommendation
            lead={lead}
            message={r.message}
            preparedBy={r.preparedBy}
            options={r.options.map((o) => ({
              title: o.title,
              description: o.description,
              parts: o.components.map((c) => ({ name: c.name, quantity: c.quantity })),
              price: o.priceMinor !== null ? money(o.priceMinor, lead.exponent, lead.currency) : null,
              photoUrls: o.images.map((i) => i.url)
            }))}
          />
        </>
      )}
    </section>
  );
}

/** Nameplate photos the customer added, each labelled with what it shows. Tap to open full size. */
function LeadPhotos({ lead }: { lead: Lead }) {
  const photos = lead.photos.filter((p) => p.url);
  if (!photos.length) return null;
  return (
    <section className="lead-block">
      <h2>Nameplate photos ({photos.length})</h2>
      <p className="hint">Read the ratings from these to check the numbers the customer typed.</p>
      <div className="lead-photos">
        {photos.map((p) => (
          <figure key={p.id}>
            <a href={p.url!} target="_blank" rel="noopener noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url!} alt={`Nameplate: ${p.label}`} loading="lazy" />
            </a>
            <figcaption>{p.label}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function LeadDetail({ leadId }: { leadId: Id<"quoteRequests"> }) {
  const lead = useQuery(api.responses.getLead, { leadId });
  if (lead === undefined) return <p className="muted">Loading request…</p>;
  return (
    <div className="lead-detail">
      <Specs lead={lead} />
      <LeadPhotos lead={lead} />
      {lead.canRespond ? <ResponseEditor key={lead.id} lead={lead} /> : <ReadOnlyResponse lead={lead} />}
    </div>
  );
}

export default function LeadPage() {
  const params = useParams<{ id: string }>();
  return (
    <ConfiguredOnly>
      <CompanyPage title="Quote request" allowedRoles={["super_admin", "inventory_admin", "sales_manager", "sales_agent", "technician"]}>
        {() => <LeadDetail leadId={params.id as Id<"quoteRequests">} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
