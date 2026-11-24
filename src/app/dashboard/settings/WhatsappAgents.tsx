"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { errorMessage } from "../workspace";

type Row = { key: string; number: string; name: string; userId: string };
const newRow = (): Row => ({ key: Math.random().toString(36).slice(2), number: "", name: "", userId: "" });

/**
 * Several sales agents' WhatsApp numbers. Public requests (energy, upgrade and budget checks, item
 * price requests) go to each number in turn, and to that agent's record book.
 */
export function WhatsappAgents({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.whatsappAgents.listAgents, { tenantId });
  const save = useMutation(api.whatsappAgents.setAgents);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data && rows === null) {
      setRows(data.agents.map((a) => ({ key: Math.random().toString(36).slice(2), number: `+${a.number}`, name: a.name, userId: a.userId ?? "" })));
    }
  }, [data, rows]);

  if (!data || rows === null) return null;
  const set = (key: string, patch: Partial<Row>) => setRows((all) => all!.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit() {
    setBusy(true);
    setNotice(null);
    try {
      const filled = rows!.filter((r) => r.number.trim());
      const { count } = await save({
        tenantId,
        agents: filled.map((r) => ({ number: r.number, name: r.name, userId: (r.userId || undefined) as Id<"userProfiles"> | undefined }))
      });
      setNotice({ ok: true, text: count ? `Saved. Requests now go to ${count} number(s) in turn.` : "Saved. Requests go to the company WhatsApp number." });
    } catch (e) {
      setNotice({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel-form" aria-labelledby="wa-agents">
      <h2 id="wa-agents">WhatsApp numbers for requests</h2>
      <p className="hint">
        Add each sales agent&apos;s WhatsApp number. New requests from the public go to these numbers in turn, so the work is
        shared. Each request shows which number it went to, when the customer opened WhatsApp, and when the agent replied.
        With no numbers here, requests go to the company number{data.companyNumber ? ` (+${data.companyNumber})` : ""}.
      </p>
      <div className="invoice-lines">
        {rows.map((r, i) => (
          <div key={r.key} className="wa-row">
            <input aria-label={`Number ${i + 1}`} type="tel" placeholder="+256 700 000000" value={r.number} onChange={(e) => set(r.key, { number: e.target.value })} />
            <select
              aria-label={`Staff member for number ${i + 1}`}
              value={r.userId}
              onChange={(e) => set(r.key, { userId: e.target.value, name: r.name || data.staff.find((s) => s.userId === e.target.value)?.name || "" })}
            >
              <option value="">Not linked to staff</option>
              {data.staff.map((s) => <option key={s.userId} value={s.userId}>{s.name}</option>)}
            </select>
            <input aria-label={`Name for number ${i + 1}`} placeholder="Name shown, e.g. Sarah (Sales)" maxLength={60} value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} />
            <button type="button" className="link-button" aria-label={`Remove number ${i + 1}`} onClick={() => setRows((all) => all!.filter((x) => x.key !== r.key))}>✕</button>
          </div>
        ))}
      </div>
      <div className="stock-edit-row">
        <button type="button" className="button button-small button-secondary" onClick={() => setRows((all) => [...all!, newRow()])}>＋ Add a number</button>
        <button type="button" className="button button-small" disabled={busy} onClick={submit}>{busy ? "Saving…" : "Save numbers"}</button>
      </div>
      <p className="hint">Linking a number to a staff member assigns that person the request, so it appears in their record book.</p>
      {notice ? <p className={notice.ok ? "form-success" : "auth-message"} role="status">{notice.text}</p> : null}
    </section>
  );
}
