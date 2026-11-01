"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { idbAvailable, idbBackend } from "./idb";
import {
  OfflineStore,
  type CatalogueItem,
  type OfflineState,
  type Outcome,
  type SnapshotShape
} from "./store";

const SYNC_EVERY_MS = 30_000;

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** One shared store for the page; every state change re-reads it so the screen matches what is on the device. */
export function useOfflineStore() {
  const store = useMemo(() => (idbAvailable() ? new OfflineStore(idbBackend) : null), []);
  const [state, setState] = useState<OfflineState | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  const reload = useCallback(async () => {
    if (!store) return;
    try {
      setState(await store.read());
    } catch {
      setUnsupported(true);
    }
  }, [store]);

  useEffect(() => {
    if (!store) setUnsupported(true);
    else void reload();
  }, [store, reload]);

  return { store, state, reload, unsupported };
}

export type SyncStatus = { running: boolean; message: string; error: boolean };

/**
 * Sends unsent changes, then refreshes the device's copy of server data.
 * Runs when the page opens, when the connection returns, on a timer, and on demand.
 */
export function useSync(args: {
  store: OfflineStore | null;
  reload: () => Promise<void>;
  tenantId: Id<"tenants"> | undefined;
  enabled: boolean;
}) {
  const { store, reload, tenantId, enabled } = args;
  const convex = useConvex();
  const [status, setStatus] = useState<SyncStatus>({ running: false, message: "", error: false });
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (!store || !tenantId || !enabled || busy.current) return;
    busy.current = true;
    setStatus({ running: true, message: "Syncing…", error: false });
    try {
      const tally = await store.flush(async (tenant, operations) => {
        const { outcomes } = await convex.mutation(api.sync.push, {
          tenantId: tenant as Id<"tenants">,
          operations: operations as never
        });
        return outcomes as Outcome[];
      });
      const [snapshot, products, conflicts] = await Promise.all([
        convex.query(api.sync.snapshot, { tenantId }),
        convex.query(api.products.listProducts, { tenantId }).catch(() => null),
        convex.query(api.sync.listConflicts, { tenantId })
      ]);
      const catalogue: CatalogueItem[] | undefined = products?.products
        .filter((p) => p.status === "active")
        .map((p) => ({
          id: p.id, name: p.name, brand: p.brand, model: p.model, sku: p.sku,
          categoryName: p.categoryName, listPrice: p.listPrice
        }));
      await store.applySnapshot(snapshot as unknown as SnapshotShape, catalogue);
      await store.releaseResolvedConflicts(conflicts.conflicts.map((c) => c.assessmentId));

      const parts = [];
      if (tally.applied) parts.push(`${tally.applied} change${tally.applied === 1 ? "" : "s"} sent`);
      if (tally.conflicts) parts.push(`${tally.conflicts} held for review`);
      if (tally.rejected) parts.push(`${tally.rejected} not accepted`);
      setStatus({ running: false, message: parts.length ? parts.join(", ") + "." : "Up to date.", error: tally.rejected > 0 });
    } catch {
      setStatus({ running: false, message: "Could not reach the server. Your work is safe on this device.", error: true });
    } finally {
      busy.current = false;
      await reload();
    }
  }, [store, tenantId, enabled, convex, reload]);

  useEffect(() => {
    if (!enabled) return;
    void sync();
    const timer = setInterval(() => void sync(), SYNC_EVERY_MS);
    window.addEventListener("online", sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", sync);
    };
  }, [enabled, sync]);

  return { status, sync };
}
