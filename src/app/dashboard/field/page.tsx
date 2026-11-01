"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useOfflineStore, useOnline, useSync } from "../../../lib/offline/useOffline";
import {
  describe,
  isStale,
  pendingCount,
  type OfflineState,
  type OfflineStore,
  type Ref,
  type Work
} from "../../../lib/offline/store";
import { AssessmentForm } from "../assessments/AssessmentForm";
import { errorMessage, StatusCard, WorkspaceHeader } from "../workspace";
import { CUSTOMER_TYPES, GRID_LABELS, type GridAvailability } from "../crm";

const WRITERS = ["super_admin", "sales_manager", "sales_agent"];

type Entry = { value: string; ref: Ref; ids: string[]; name: string };

const asRef = (value: string): Ref =>
  value.startsWith("s:") ? { serverId: value.slice(2) } : { clientId: value.slice(2) };

function customerEntries(state: OfflineState): Entry[] {
  const server: Entry[] = (state.snapshot?.customers ?? []).map((c) => ({
    value: `s:${c.id}`, ref: { serverId: c.id }, ids: [c.id], name: c.name
  }));
  const local: Entry[] = state.localCustomers
    .filter((c) => !c.serverId || !server.some((s) => s.ids.includes(c.serverId!)))
    .map((c) => ({
      value: c.serverId ? `s:${c.serverId}` : `c:${c.clientId}`,
      ref: c.serverId ? { serverId: c.serverId } : { clientId: c.clientId },
      ids: [c.clientId, c.serverId ?? ""],
      name: `${c.name}${c.serverId ? "" : " (not sent yet)"}`
    }));
  return [...server, ...local].sort((a, b) => a.name.localeCompare(b.name));
}

function siteEntries(state: OfflineState, customer: Entry | undefined): Entry[] {
  if (!customer) return [];
  const server: Entry[] = (state.snapshot?.sites ?? [])
    .filter((s) => customer.ids.includes(s.customerId))
    .map((s) => ({ value: `s:${s.id}`, ref: { serverId: s.id }, ids: [s.id], name: s.name }));
  const local: Entry[] = state.localSites
    .filter((s) => customer.ids.includes(s.customer.serverId ?? "") || customer.ids.includes(s.customer.clientId ?? ""))
    .filter((s) => !s.serverId || !server.some((x) => x.ids.includes(s.serverId!)))
    .map((s) => ({
      value: s.serverId ? `s:${s.serverId}` : `c:${s.clientId}`,
      ref: s.serverId ? { serverId: s.serverId } : { clientId: s.clientId },
      ids: [s.clientId, s.serverId ?? ""],
      name: `${s.name}${s.serverId ? "" : " (not sent yet)"}`
    }));
  return [...server, ...local];
}

const workKey = (w: Work) => w.ref.serverId ?? w.ref.clientId ?? "";

function Banner(props: {
  online: boolean;
  state: OfflineState;
  syncing: boolean;
  message: string;
  error: boolean;
  onSync: () => void;
}) {
  const { online, state, syncing, message, error, onSync } = props;
  const stale = isStale(state.syncedAt);
  return (
    <section className="pricing-box" aria-live="polite">
      <p>
        <span className={online ? "pill" : "pill pill-warn"}>{online ? "Online" : "Offline"}</span>{" "}
        <strong>{pendingCount(state)}</strong> change(s) waiting to be sent
      </p>
      <p className="record-meta">
        {state.syncedAt ? `Last synced ${new Date(state.syncedAt).toLocaleString()}.` : "Not synced yet."}
        {stale ? " This device's copy of customers, appliances and prices is more than a day old." : ""}
      </p>
      {message ? <p className={error ? "auth-message" : "hint"}>{message}</p> : null}
      <button className="button button-secondary button-small" type="button" disabled={!online || syncing} onClick={onSync}>
        {syncing ? "Syncing…" : "Sync now"}
      </button>
    </section>
  );
}

function NewCustomer({ store, reload }: { store: OfflineStore; reload: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState("residential");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await store.addCustomer({ name, phone, type });
    setName("");
    setPhone("");
    await reload();
  };
  return (
    <form className="panel-form" onSubmit={submit}>
      <h2>New customer</h2>
      <label htmlFor="fc-name">Name</label>
      <input id="fc-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <label htmlFor="fc-phone">Phone</label>
      <input id="fc-phone" required type="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} />
      <label htmlFor="fc-type">Customer type</label>
      <select id="fc-type" value={type} onChange={(e) => setType(e.target.value)}>
        {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <button className="button" type="submit">Save on this device</button>
    </form>
  );
}

function Visit({ state, store, reload, onOpen, afterChange }: {
  state: OfflineState;
  store: OfflineStore;
  reload: () => Promise<void>;
  onOpen: (key: string) => void;
  afterChange: () => void;
}) {
  const customers = customerEntries(state);
  const [customerValue, setCustomerValue] = useState("");
  const customer = customers.find((c) => c.value === customerValue);
  const sites = siteEntries(state, customer);
  const [siteValue, setSiteValue] = useState("");
  const site = sites.find((s) => s.value === siteValue);
  const [siteName, setSiteName] = useState("");
  const [address, setAddress] = useState("");
  const [region, setRegion] = useState("");
  const [grid, setGrid] = useState<GridAvailability>("none");

  return (
    <>
      <NewCustomer store={store} reload={async () => { await reload(); afterChange(); }} />
      <section className="panel-form" aria-labelledby="visit-h">
        <h2 id="visit-h">Start an assessment</h2>
        <label htmlFor="v-cust">Customer</label>
        <select id="v-cust" value={customerValue} onChange={(e) => { setCustomerValue(e.target.value); setSiteValue(""); }}>
          <option value="">Choose a customer…</option>
          {customers.map((c) => <option key={c.value} value={c.value}>{c.name}</option>)}
        </select>
        {customer ? (
          <>
            <label htmlFor="v-site">Site</label>
            <select id="v-site" value={siteValue} onChange={(e) => setSiteValue(e.target.value)}>
              <option value="">Choose a site…</option>
              {sites.map((s) => <option key={s.value} value={s.value}>{s.name}</option>)}
            </select>
            <fieldset className="panel-form">
              <legend>Or add a site</legend>
              <label htmlFor="v-sn">Site name</label>
              <input id="v-sn" maxLength={80} value={siteName} onChange={(e) => setSiteName(e.target.value)} />
              <label htmlFor="v-sa">Address</label>
              <input id="v-sa" maxLength={200} value={address} onChange={(e) => setAddress(e.target.value)} />
              <label htmlFor="v-sr">Region</label>
              <input id="v-sr" maxLength={80} value={region} onChange={(e) => setRegion(e.target.value)} />
              <label htmlFor="v-sg">Grid availability</label>
              <select id="v-sg" value={grid} onChange={(e) => setGrid(e.target.value as GridAvailability)}>
                {(Object.keys(GRID_LABELS) as GridAvailability[]).map((g) => <option key={g} value={g}>{GRID_LABELS[g]}</option>)}
              </select>
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={!siteName.trim() || !address.trim() || !region.trim()}
                onClick={async () => {
                  const { clientId } = await store.addSite({ customer: customer.ref, name: siteName, address, region, gridAvailability: grid });
                  setSiteName(""); setAddress(""); setRegion("");
                  await reload();
                  setSiteValue(`c:${clientId}`);
                  afterChange();
                }}
              >
                Save site on this device
              </button>
            </fieldset>
          </>
        ) : null}
        <button
          type="button"
          className="button"
          disabled={!customer || !site}
          onClick={async () => {
            if (!customer || !site) return;
            const { clientId } = await store.startAssessment({
              customer: customer.ref, site: site.ref,
              customerName: customer.name.replace(" (not sent yet)", ""), siteName: site.name.replace(" (not sent yet)", "")
            });
            await reload();
            afterChange();
            onOpen(clientId);
          }}
        >
          Start assessment
        </button>
      </section>
    </>
  );
}

function Conflicts({ tenantId }: { tenantId: Id<"tenants"> }) {
  const data = useQuery(api.sync.listConflicts, { tenantId });
  const resolve = useMutation(api.sync.resolveConflict);
  const [error, setError] = useState("");
  if (!data || data.conflicts.length === 0) return null;
  return (
    <section aria-labelledby="cf-h" className="workspace-section">
      <h2 id="cf-h">Changes waiting for your decision ({data.conflicts.length})</h2>
      {error ? <p className="auth-message" role="alert">{error}</p> : null}
      <ul className="record-list">
        {data.conflicts.map((c) => (
          <li className="record-card" key={c.id}>
            <div>
              <span className="record-title">{c.customerName}</span>
              <span className="record-meta">{c.reason}</span>
              <span className="record-meta">
                Your version: {c.mine.lines} appliance(s), {c.mine.dailyEnergyWh ?? "?"} Wh/day · Server (revision {c.server.revision}): {c.server.lines} appliance(s), {c.server.dailyEnergyWh ?? "?"} Wh/day
              </span>
            </div>
            <div className="record-actions">
              {(["use_mine", "use_server"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  className="button button-secondary button-small"
                  onClick={async () => {
                    setError("");
                    try { await resolve({ conflictId: c.id, choice }); } catch (e) { setError(errorMessage(e)); }
                  }}
                >
                  {choice === "use_mine" ? "Use my version" : "Keep the server's"}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Field() {
  const router = useRouter();
  const online = useOnline();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { store, state, reload, unsupported } = useOfflineStore();
  const viewer = useQuery(api.users.viewerContext, isAuthenticated ? {} : "skip");
  const company = viewer?.state === "active" ? viewer.companies[0] : undefined;
  const session = state?.session;
  const canWrite = WRITERS.includes(session?.role ?? company?.role ?? "");
  const { status, sync } = useSync({
    store, reload, tenantId: company?.tenantId, enabled: Boolean(company) && online && isAuthenticated
  });
  const [editing, setEditing] = useState<string | null>(null);

  // Signed out and nothing on the device: send them to sign in once they can.
  const noCache = state !== null && !session;
  useEffect(() => {
    if (online && !isLoading && !isAuthenticated && noCache) router.replace("/sign-in");
  }, [online, isLoading, isAuthenticated, noCache, router]);

  if (unsupported) {
    return (
      <StatusCard eyebrow="OFFLINE WORK" title="This browser cannot store work offline">
        <p>Use a recent version of Chrome, Edge, Safari or Firefox, and not a private window.</p>
      </StatusCard>
    );
  }
  if (!state || !store) return <StatusCard eyebrow="OFFLINE WORK" title="Loading…"><p>Opening this device&apos;s saved data.</p></StatusCard>;
  if (!session) {
    return (
      <StatusCard eyebrow="OFFLINE WORK" title={online ? "Getting ready…" : "Not ready for offline use"}>
        <p>
          {online
            ? "Downloading customers and appliances to this device. This only happens while you are online."
            : "Open this page once while online and signed in. After that it works without a connection."}
        </p>
      </StatusCard>
    );
  }

  const work = state.work.find((w) => workKey(w) === editing || w.ref.clientId === editing);
  const shared = (
    <>
      <WorkspaceHeader role={session.role} />
      <main className="workspace">
        <p className="eyebrow">{session.companyName.toUpperCase()} · FIELD WORK</p>
        <h1>Field assessments</h1>
        <Banner
          online={online} state={state} syncing={status.running} message={status.message} error={status.error} onSync={() => void sync()}
        />
        {!online || !isAuthenticated ? (
          <p className="hint">
            You are working from this device&apos;s saved copy, as {session.displayName}. Anyone who can open this
            device can see it, so sign out when you are finished.
          </p>
        ) : null}
        {company ? <Conflicts tenantId={company.tenantId} /> : null}
      </main>
    </>
  );

  if (work) {
    return (
      <div className="shell">
        {shared}
        <main className="workspace">
          <p><button type="button" className="button button-secondary button-small" onClick={() => setEditing(null)}>← Back to field work</button></p>
          <h2>{work.customerName} · {work.siteName}</h2>
          {work.conflict ? (
            <p className="auth-message">
              The server changed this assessment while you were offline. Your version is being held; choose which to
              keep in &quot;Changes waiting for your decision&quot; while online.
            </p>
          ) : (
            <p className="hint">
              Saved on this device and sent when you are online. Complete the assessment from the Assessments page
              while online; nothing here becomes official.
            </p>
          )}
          {work.conflict || !canWrite ? null : (
            <AssessmentForm
              key={workKey(work)}
              initial={work.inputs}
              library={state.snapshot?.appliances ?? []}
              currency={session.currency}
              allowComplete={false}
              onSave={async (inputs) => {
                try {
                  await store.saveWork(workKey(work), inputs);
                } catch (e) {
                  throw new Error(e instanceof Error ? e.message : "Could not save on this device.");
                }
                await reload();
                if (online && isAuthenticated) void sync();
                return online ? "Saved on this device. Sending…" : "Saved on this device. It will be sent when you are online.";
              }}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      {shared}
      <main className="workspace">
        {canWrite ? (
          <Visit state={state} store={store} reload={reload} onOpen={setEditing} afterChange={() => { if (online && isAuthenticated) void sync(); }} />
        ) : (
          <p className="muted">Your role can read assessments but not change them.</p>
        )}

        <section aria-labelledby="work-h" className="workspace-section">
          <h2 id="work-h">Drafts on this device ({state.work.length})</h2>
          {state.work.length === 0 ? <p className="muted">No drafts yet.</p> : (
            <ul className="record-list">
              {state.work.map((w) => (
                <li className="record-card" key={workKey(w)}>
                  <div>
                    <span className="record-title">{w.customerName} · {w.siteName}</span>
                    <span className="record-meta">{w.inputs.lines.length} appliance(s) · revision {w.baseRevision}</span>
                    {w.conflict ? <span className="pill pill-warn">held for review</span> : w.dirty ? <span className="pill pill-warn">not sent yet</span> : <span className="pill">in sync</span>}
                  </div>
                  <div className="record-actions">
                    <button type="button" className="button button-secondary button-small" onClick={() => setEditing(workKey(w))}>
                      {canWrite && !w.conflict ? "Open" : "View"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {state.outbox.length > 0 ? (
          <section aria-labelledby="out-h" className="workspace-section">
            <h2 id="out-h">Waiting to be sent ({state.outbox.length})</h2>
            <ul className="record-list">
              {state.outbox.map((e) => (
                <li className="record-card" key={e.opId}>
                  <div>
                    <span className="record-title">{describe(e.op)}</span>
                    <span className="record-meta">{new Date(e.createdAt).toLocaleString()}</span>
                    {e.state === "rejected" ? <span className="auth-message">Not accepted: {e.message}</span> : <span className="pill pill-warn">pending</span>}
                  </div>
                  <div className="record-actions">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      onClick={async () => {
                        if (e.state === "pending" && !window.confirm("Discard this change? It has not been sent.")) return;
                        await store.discard(e.opId);
                        await reload();
                      }}
                    >
                      Discard
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="cat-h" className="workspace-section">
          <h2 id="cat-h">Catalogue prices on this device</h2>
          {state.catalogue ? (
            <>
              <p className={isStale(state.catalogue.savedAt) ? "auth-message" : "hint"}>
                List prices as of {new Date(state.catalogue.savedAt).toLocaleString()}
                {isStale(state.catalogue.savedAt) ? " — out of date. Check again when online." : "."} These are not quotes:
                prices, stock and compatibility are checked again when a quotation is issued.
              </p>
              <details className="category-card">
                <summary><strong>{state.catalogue.products.length} products</strong></summary>
                <ul className="category-body">
                  {state.catalogue.products.map((p) => (
                    <li key={p.id}>{p.name} ({p.sku}) — {p.listPrice ? `${p.listPrice.currency} ${Number(p.listPrice.amount).toLocaleString()}` : "no price"}</li>
                  ))}
                </ul>
              </details>
            </>
          ) : <p className="muted">Not downloaded yet. Open this page online.</p>}
        </section>
        <p><Link href="/dashboard">← Dashboard</Link></p>
      </main>
    </div>
  );
}

export default function FieldPage() {
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) {
    return (
      <StatusCard eyebrow="LUMINA WORKSPACE" title="Authentication is not configured yet">
        <p>Add the Convex deployment URL to the application environment before signing in.</p>
      </StatusCard>
    );
  }
  return <Field />;
}
