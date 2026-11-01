/**
 * Local-first storage for field work. Everything a device keeps lives in one
 * state object behind a small key-value backend (IndexedDB in the browser, a
 * Map in tests). Work done offline is recorded as an ordered outbox of
 * operations, each with its own id, and sent to the server when a connection
 * returns. Nothing in here can complete an assessment or issue a quotation.
 */
import type { Inputs } from "../../app/dashboard/assessments/AssessmentForm";

export interface Backend {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryBackend implements Backend {
  private data = new Map<string, unknown>();
  async get<T>(key: string) {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async clear() {
    this.data.clear();
  }
}

export type Ref = { serverId?: string; clientId?: string };
const refKey = (r: Ref) => r.serverId ?? r.clientId ?? "";
/** Two references name the same record if they share a server id or a device id. */
const sameRef = (a: Ref, b: Ref) =>
  Boolean((a.serverId && a.serverId === b.serverId) || (a.clientId && a.clientId === b.clientId));

export type Operation =
  | { type: "customer.create"; clientId: string; payload: Record<string, unknown> }
  | { type: "site.create"; clientId: string; customer: Ref; payload: Record<string, unknown> }
  | { type: "assessment.create"; clientId: string; customer: Ref; site: Ref }
  | { type: "assessment.save"; assessment: Ref; baseRevision: number; payload: Inputs };

export type OutboxEntry = {
  opId: string;
  profileId: string;
  tenantId: string;
  createdAt: number;
  state: "pending" | "rejected";
  message?: string;
  op: Operation;
};

export type Session = {
  profileId: string;
  tenantId: string;
  companyName: string;
  currency: string;
  role: string;
  displayName: string;
};

export type SnapshotShape = {
  takenAt: number;
  profileId: string;
  displayName: string;
  company: { tenantId: string; name: string; defaultCurrency: string; role: string };
  customers: { id: string; name: string; phone: string; type: string }[];
  sites: { id: string; customerId: string; name: string; address: string; region: string; gridAvailability: string }[];
  appliances: {
    id: string; name: string; category: string; powerW: number; surgeW: number | null;
    powerFactor: number | null; typicalHoursPerDay: number; currentType: "ac" | "dc";
  }[];
  assessments: { id: string; customerId: string; siteId: string; revision: number; inputs: Inputs }[];
};

export type CatalogueItem = {
  id: string; name: string; brand: string; model: string; sku: string; categoryName: string;
  listPrice: { currency: string; amount: string } | null;
};

export type LocalCustomer = { clientId: string; serverId?: string; name: string; phone: string; type: string };
export type LocalSite = {
  clientId: string; serverId?: string; customer: Ref; name: string; address: string; region: string;
};

/** A device-side working copy of an assessment draft. */
export type Work = {
  ref: Ref;
  customer: Ref;
  site: Ref;
  customerName: string;
  siteName: string;
  baseRevision: number;
  inputs: Inputs;
  dirty: boolean;
  // The server holds this device's version for review; resolve it online.
  conflict: boolean;
  updatedAt: number;
};

export type OfflineState = {
  session?: Session;
  syncedAt?: number;
  snapshot?: SnapshotShape;
  catalogue?: { savedAt: number; products: CatalogueItem[] };
  localCustomers: LocalCustomer[];
  localSites: LocalSite[];
  work: Work[];
  outbox: OutboxEntry[];
};

const EMPTY: OfflineState = { localCustomers: [], localSites: [], work: [], outbox: [] };
const KEY = "state";
const CHUNK = 50;

export type Outcome = {
  opId: string;
  status: "applied" | "conflict" | "rejected";
  id?: string;
  revision?: number;
  message?: string;
};
export type Push = (tenantId: string, ops: { opId: string; [k: string]: unknown }[]) => Promise<Outcome[]>;

export class OfflineStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private backend: Backend,
    private env: { uuid: () => string; now: () => number } = {
      uuid: () => crypto.randomUUID(),
      now: () => Date.now()
    }
  ) {}

  /** Serialises read-modify-write cycles so two actions never overwrite each other. */
  private mutate<T>(fn: (s: OfflineState) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const state = (await this.backend.get<OfflineState>(KEY)) ?? structuredClone(EMPTY);
      const result = await fn(state);
      await this.backend.set(KEY, state);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async read(): Promise<OfflineState> {
    return await this.queue.then(async () => (await this.backend.get<OfflineState>(KEY)) ?? structuredClone(EMPTY));
  }

  /** Wipes everything held on this device (used on sign-out). */
  async clear() {
    await this.queue.then(() => this.backend.clear());
  }

  // ---------------------------------------------------------------- server data

  applySnapshot(snap: SnapshotShape, catalogue?: CatalogueItem[]) {
    return this.mutate((s) => {
      // A different person on the same device must not see or send the previous person's data.
      if (s.session && s.session.profileId !== snap.profileId) {
        s.localCustomers = [];
        s.localSites = [];
        s.work = [];
      }
      s.session = {
        profileId: snap.profileId,
        tenantId: snap.company.tenantId,
        companyName: snap.company.name,
        currency: snap.company.defaultCurrency,
        role: snap.company.role,
        displayName: snap.displayName
      };
      s.snapshot = snap;
      s.syncedAt = this.env.now();
      if (catalogue) s.catalogue = { savedAt: this.env.now(), products: catalogue };

      const known = new Set([...snap.customers.map((c) => c.id), ...snap.sites.map((x) => x.id)]);
      s.localCustomers = s.localCustomers.filter((c) => !(c.serverId && known.has(c.serverId)));
      s.localSites = s.localSites.filter((x) => !(x.serverId && known.has(x.serverId)));

      const names = new Map(snap.customers.map((c) => [c.id, c.name]));
      const siteNames = new Map(snap.sites.map((x) => [x.id, x.name]));
      for (const a of snap.assessments) {
        const existing = s.work.find((w) => w.ref.serverId === a.id);
        if (existing) {
          // Unsent edits always win locally; the server decides at sync time.
          if (!existing.dirty && !existing.conflict) {
            existing.inputs = a.inputs;
            existing.baseRevision = a.revision;
          }
        } else {
          s.work.push({
            ref: { serverId: a.id },
            customer: { serverId: a.customerId },
            site: { serverId: a.siteId },
            customerName: names.get(a.customerId) ?? "Customer",
            siteName: siteNames.get(a.siteId) ?? "Site",
            baseRevision: a.revision,
            inputs: a.inputs,
            dirty: false,
            conflict: false,
            updatedAt: this.env.now()
          });
        }
      }
      // Drafts that were completed or removed on the server and have no local edits are dropped.
      const live = new Set(snap.assessments.map((a) => a.id));
      s.work = s.work.filter((w) => !w.ref.serverId || live.has(w.ref.serverId) || w.dirty || w.conflict);
    });
  }

  // ---------------------------------------------------------------- local changes

  private enqueue(s: OfflineState, op: Operation): OutboxEntry {
    if (!s.session) throw new Error("Sign in and sync once while online before working offline.");
    const entry: OutboxEntry = {
      opId: this.env.uuid(),
      profileId: s.session.profileId,
      tenantId: s.session.tenantId,
      createdAt: this.env.now(),
      state: "pending",
      op
    };
    s.outbox.push(entry);
    return entry;
  }

  addCustomer(data: { name: string; phone: string; type: string; email?: string; notes?: string }) {
    return this.mutate((s) => {
      const clientId = this.env.uuid();
      s.localCustomers.push({ clientId, name: data.name.trim(), phone: data.phone.trim(), type: data.type });
      this.enqueue(s, { type: "customer.create", clientId, payload: { ...data, name: data.name.trim() } });
      return { clientId };
    });
  }

  addSite(data: { customer: Ref; name: string; address: string; region: string; gridAvailability: string }) {
    return this.mutate((s) => {
      const clientId = this.env.uuid();
      s.localSites.push({
        clientId, customer: data.customer, name: data.name.trim(), address: data.address.trim(), region: data.region.trim()
      });
      this.enqueue(s, {
        type: "site.create",
        clientId,
        customer: data.customer,
        payload: {
          name: data.name, address: data.address, region: data.region,
          gpsConsent: false, gridAvailability: data.gridAvailability
        }
      });
      return { clientId };
    });
  }

  startAssessment(args: { customer: Ref; site: Ref; customerName: string; siteName: string }) {
    return this.mutate((s) => {
      const clientId = this.env.uuid();
      this.enqueue(s, { type: "assessment.create", clientId, customer: args.customer, site: args.site });
      s.work.push({
        ref: { clientId },
        customer: args.customer,
        site: args.site,
        customerName: args.customerName,
        siteName: args.siteName,
        baseRevision: 1,
        inputs: { systemType: "off_grid", lines: [] },
        dirty: false,
        conflict: false,
        updatedAt: this.env.now()
      });
      return { clientId };
    });
  }

  /** Saves the working copy and keeps exactly one unsent save per assessment, holding the latest inputs. */
  saveWork(key: string, inputs: Inputs) {
    return this.mutate((s) => {
      const work = s.work.find((w) => refKey(w.ref) === key || w.ref.clientId === key);
      if (!work) throw new Error("That assessment is no longer on this device.");
      if (work.conflict) throw new Error("This assessment has a conflict waiting online. Resolve it first.");
      work.inputs = inputs;
      work.dirty = true;
      work.updatedAt = this.env.now();

      const existing = s.outbox.find((e) => e.op.type === "assessment.save" && sameRef(e.op.assessment, work.ref));
      if (existing && existing.op.type === "assessment.save") {
        // Keep the revision this device first edited from, so a server change since then is still caught.
        existing.op = { ...existing.op, payload: inputs };
        existing.opId = this.env.uuid();
        existing.state = "pending";
        existing.message = undefined;
      } else {
        this.enqueue(s, { type: "assessment.save", assessment: work.ref, baseRevision: work.baseRevision, payload: inputs });
      }
    });
  }

  /** Throws away an unsent change and everything that depends on it. */
  discard(opId: string) {
    return this.mutate((s) => {
      const target = s.outbox.find((e) => e.opId === opId);
      if (!target) return;
      const gone = new Set<string>();
      const idOf = (op: Operation) => ("clientId" in op ? op.clientId : undefined);
      const rootId = idOf(target.op);
      if (rootId) gone.add(rootId);
      s.outbox = s.outbox.filter((e) => e !== target);
      let changed = true;
      while (changed) {
        changed = false;
        for (const e of [...s.outbox]) {
          const refs: Ref[] =
            e.op.type === "site.create" ? [e.op.customer]
            : e.op.type === "assessment.create" ? [e.op.customer, e.op.site]
            : e.op.type === "assessment.save" ? [e.op.assessment]
            : [];
          if (refs.some((r) => r.clientId && gone.has(r.clientId))) {
            s.outbox = s.outbox.filter((x) => x !== e);
            const id = idOf(e.op);
            if (id) gone.add(id);
            changed = true;
          }
        }
      }
      s.localCustomers = s.localCustomers.filter((c) => !gone.has(c.clientId));
      s.localSites = s.localSites.filter((x) => !gone.has(x.clientId));
      s.work = s.work.filter((w) => !(w.ref.clientId && gone.has(w.ref.clientId)));
      if (target.op.type === "assessment.save") {
        // The edit is dropped; the working copy goes back to what the server last sent.
        const targetRef = target.op.assessment;
        const w = s.work.find((x) => sameRef(x.ref, targetRef));
        if (w) {
          const server = s.snapshot?.assessments.find((a) => a.id === w.ref.serverId);
          if (server) {
            w.inputs = server.inputs;
            w.baseRevision = server.revision;
          }
          w.dirty = false;
        }
      }
    });
  }

  /** Called online with the ids of assessments that still have an open conflict on the server. */
  releaseResolvedConflicts(openAssessmentIds: string[]) {
    return this.mutate((s) => {
      const open = new Set(openAssessmentIds);
      s.work = s.work.filter((w) => !(w.conflict && !(w.ref.serverId && open.has(w.ref.serverId))));
    });
  }

  // ---------------------------------------------------------------- sending

  /**
   * Sends this person's unsent changes in order. Resolves with how many were
   * applied. A thrown error (no connection) leaves everything untouched.
   */
  async flush(push: Push) {
    const initial = await this.read();
    const session = initial.session;
    if (!session) return { applied: 0, conflicts: 0, rejected: 0 };
    const tally = { applied: 0, conflicts: 0, rejected: 0 };

    for (;;) {
      const batch = (await this.read()).outbox
        .filter((e) => e.profileId === session.profileId && e.tenantId === session.tenantId && e.state === "pending")
        .slice(0, CHUNK);
      if (batch.length === 0) break;

      const outcomes = await push(
        session.tenantId,
        batch.map((e) => ({ opId: e.opId, ...e.op }))
      );
      const byId = new Map(outcomes.map((o) => [o.opId, o]));

      await this.mutate((s) => {
        for (const sent of batch) {
          const o = byId.get(sent.opId);
          const entry = s.outbox.find((e) => e.opId === sent.opId);
          // The person edited this change while it was in flight: the newer one will be sent next time.
          if (!o || !entry) continue;
          const op = sent.op;

          if (o.status === "rejected") {
            entry.state = "rejected";
            entry.message = o.message;
            tally.rejected++;
            continue;
          }
          s.outbox = s.outbox.filter((e) => e !== entry);

          if (o.status === "conflict") {
            tally.conflicts++;
            const w = op.type === "assessment.save" ? s.work.find((x) => sameRef(x.ref, op.assessment)) : undefined;
            if (w) w.conflict = true;
            continue;
          }
          tally.applied++;
          if (op.type === "customer.create") {
            const c = s.localCustomers.find((x) => x.clientId === op.clientId);
            if (c) c.serverId = o.id;
          } else if (op.type === "site.create") {
            const x = s.localSites.find((y) => y.clientId === op.clientId);
            if (x) x.serverId = o.id;
          } else if (op.type === "assessment.create") {
            const w = s.work.find((x) => x.ref.clientId === op.clientId);
            if (w) w.ref = { serverId: o.id, clientId: op.clientId };
          } else if (op.type === "assessment.save") {
            const w = s.work.find((x) => sameRef(x.ref, op.assessment));
            const newer = s.outbox.some((e) => e.op.type === "assessment.save" && sameRef(e.op.assessment, op.assessment));
            if (w) {
              w.baseRevision = o.revision ?? w.baseRevision;
              if (!newer) w.dirty = false;
            }
            for (const e of s.outbox) {
              if (e.op.type === "assessment.save" && sameRef(e.op.assessment, op.assessment)) {
                e.op = { ...e.op, baseRevision: o.revision ?? e.op.baseRevision };
              }
            }
          }
        }
      });

      // Stop if nothing moved forward, so a stuck batch cannot loop forever.
      if (!outcomes.some((o) => o.status !== "rejected")) break;
    }
    return tally;
  }
}

export function pendingCount(state: OfflineState) {
  if (!state.session) return 0;
  return state.outbox.filter((e) => e.profileId === state.session!.profileId && e.state === "pending").length;
}

export function describe(op: Operation): string {
  switch (op.type) {
    case "customer.create": return `New customer ${String(op.payload.name ?? "")}`;
    case "site.create": return `New site ${String(op.payload.name ?? "")}`;
    case "assessment.create": return "New assessment";
    case "assessment.save": return "Assessment changes";
  }
}

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const isStale = (savedAt: number | undefined, now = Date.now()) =>
  savedAt === undefined || now - savedAt > STALE_AFTER_MS;
