"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

type Tracking = { to: string | null; openedAt: number | null; repliedAt: number | null; repliedBy: string | null };
const when = (t: number) => new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

/**
 * Staff view of a request's WhatsApp follow-up: whose number it went to, whether the customer
 * opened WhatsApp, and who replied when, with a button to record a reply made on a phone.
 */
export function WhatsappFollowUp({ tracking, quoteRequestId, itemRequestId }: { tracking: Tracking; quoteRequestId?: Id<"quoteRequests">; itemRequestId?: Id<"itemRequests"> }) {
  const markReplied = useMutation(api.whatsappAgents.markReplied);
  const [busy, setBusy] = useState(false);
  return (
    <span className="pill-row wa-follow">
      {tracking.to ? <span className="pill pill-info">WhatsApp to {tracking.to}</span> : null}
      {tracking.openedAt ? <span className="pill">Customer opened WhatsApp {when(tracking.openedAt)}</span> : tracking.to ? <span className="pill">Customer has not opened WhatsApp</span> : null}
      {tracking.repliedAt ? (
        <span className="pill pill-ok">Replied on WhatsApp by {tracking.repliedBy ?? "staff"}, {when(tracking.repliedAt)}</span>
      ) : (
        <button
          type="button"
          className="button button-small button-secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await markReplied({ quoteRequestId, itemRequestId });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "✓ Mark replied on WhatsApp"}
        </button>
      )}
    </span>
  );
}

/** Records a WhatsApp reply when staff open the chat from the app (best effort, never blocks the link). */
export function useRecordReply() {
  const markReplied = useMutation(api.whatsappAgents.markReplied);
  return (ids: { quoteRequestId?: Id<"quoteRequests">; itemRequestId?: Id<"itemRequests"> }) => {
    void markReplied(ids).catch(() => undefined);
  };
}
