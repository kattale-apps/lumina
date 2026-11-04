"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CompanyPage, ConfiguredOnly, errorMessage } from "../../workspace";
import { shrinkImage } from "@/lib/shrinkImage";

type Lead = FunctionReturnType<typeof api.responses.getLead>;
type EditOption = {
  key: string;
  title: string;
  description: string;
  components: { name: string; quantity: string }[];
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
  components: [{ name: "", quantity: "1" }],
  price: ""
});

function money(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { maximumFractionDigits: exponent })}`;
}
const kw = (w: number) => (w >= 1000 ? `${(w / 1000).toFixed(w >= 10_000 ? 0 : 1)} kW` : `${Math.round(w)} W`);

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
  const phoneDigits = lead.phone.replace(/[^\d+]/g, "");
  const whatsapp = phoneDigits.replace(/^\+/, "").replace(/^0/, "256");
  return (
    <>
      <section className="lead-block lead-contact">
        <h2>{lead.name}</h2>
        <p className="muted">{lead.location} · sent {new Date(lead.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
        <div className="lead-contact-actions">
          <a className="button button-small" href={`tel:${phoneDigits}`}>📞 Call {lead.phone}</a>
          <a className="button button-small button-secondary" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a>
          {lead.email ? <a className="button button-small button-secondary" href={`mailto:${lead.email}`}>Email</a> : null}
        </div>
        <p className={lead.hasAccount ? "lead-reach lead-reach-ok" : "lead-reach"}>
          {lead.hasAccount
            ? "Has a Solar Switch account: what you send appears in their app."
            : "No account yet. They were asked to sign up to receive the recommendation in the app. Call or WhatsApp them as well."}
        </p>
      </section>

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
          components: o.components.map((c) => ({ name: c.name, quantity: String(c.quantity) })),
          price: o.priceMinor !== null ? String(o.priceMinor / 10 ** lead.exponent) : ""
        }))
      : [blankOption(0)]
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
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
        .map((c) => ({ name: c.name, quantity: Number(c.quantity) })),
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
          {o.components.map((c, ci) => (
            <div key={ci} className="part-row">
              <input aria-label="Quantity" inputMode="numeric" className="part-qty" value={c.quantity} onChange={(e) => update(i, { components: o.components.map((x, xi) => (xi === ci ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)) })} />
              <span aria-hidden="true">×</span>
              <input aria-label="Part" maxLength={100} placeholder="e.g. 550 W solar panel" value={c.name} onChange={(e) => update(i, { components: o.components.map((x, xi) => (xi === ci ? { ...x, name: e.target.value } : x)) })} />
              <button type="button" className="part-remove" aria-label={`Remove ${c.name || "part"}`} onClick={() => update(i, { components: o.components.filter((_, xi) => xi !== ci) })}>✕</button>
            </div>
          ))}
          <div className="quick-parts">
            {QUICK_PARTS.map((p) => (
              <button type="button" key={p} className="chip" onClick={() => update(i, { components: [...o.components.filter((c) => c.name.trim()), { name: p, quantity: "1" }] })}>+ {p}</button>
            ))}
          </div>

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
    </section>
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
        </>
      )}
    </section>
  );
}

function LeadDetail({ leadId }: { leadId: Id<"quoteRequests"> }) {
  const lead = useQuery(api.responses.getLead, { leadId });
  if (lead === undefined) return <p className="muted">Loading request…</p>;
  return (
    <div className="lead-detail">
      <Link className="back-link" href="/dashboard/leads">← All quote requests</Link>
      <Specs lead={lead} />
      {lead.canRespond ? <ResponseEditor key={lead.id} lead={lead} /> : <ReadOnlyResponse lead={lead} />}
    </div>
  );
}

export default function LeadPage() {
  const params = useParams<{ id: string }>();
  return (
    <ConfiguredOnly>
      <CompanyPage title="Quote request" allowedRoles={["super_admin", "sales_manager", "sales_agent", "technician"]}>
        {() => <LeadDetail leadId={params.id as Id<"quoteRequests">} />}
      </CompanyPage>
    </ConfiguredOnly>
  );
}
