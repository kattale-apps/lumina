import { ConvexError } from "convex/values";

export type QuotationStatus =
  | "draft"
  | "illustrative"
  | "submitted_for_technical_review"
  | "under_technical_review"
  | "revision_required"
  | "rejected"
  | "pending_commercial_approval"
  | "ready_for_official_issue"
  | "officially_issued"
  | "expired"
  | "withdrawn";

/** Every allowed move. Anything not listed here is refused by the server. */
export const TRANSITIONS: Record<QuotationStatus, QuotationStatus[]> = {
  draft: ["illustrative", "submitted_for_technical_review", "withdrawn"],
  illustrative: ["submitted_for_technical_review", "withdrawn"],
  submitted_for_technical_review: ["under_technical_review", "withdrawn"],
  under_technical_review: [
    "pending_commercial_approval",
    "ready_for_official_issue",
    "revision_required",
    "rejected",
    "withdrawn"
  ],
  revision_required: ["draft", "withdrawn"],
  rejected: [],
  pending_commercial_approval: ["ready_for_official_issue", "revision_required", "withdrawn"],
  ready_for_official_issue: ["officially_issued", "draft", "withdrawn"],
  officially_issued: ["expired", "withdrawn"],
  expired: [],
  withdrawn: []
};

export function assertTransition(from: QuotationStatus, to: QuotationStatus) {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConvexError(`A quotation cannot move from "${from}" to "${to}".`);
  }
}

/** Statuses in which the quotation can still be edited by a new revision. */
export const EDITABLE: QuotationStatus[] = ["draft", "illustrative", "revision_required", "ready_for_official_issue"];

/** The checklist a technician confirms before approving (docs/QUOTATION_WORKFLOW.md). */
export const TECHNICIAN_CHECKLIST = [
  { key: "load", label: "Appliance schedule and load assumptions are reasonable" },
  { key: "peak", label: "Peak coincident and starting demand considered" },
  { key: "battery", label: "Battery energy, usable capacity, current and backup duration are appropriate" },
  { key: "pv", label: "PV assumptions and string limits are valid" },
  { key: "inverter", label: "Inverter output, surge, grid mode and battery compatibility are valid" },
  { key: "bos", label: "Charge control, cables, protection, earthing and mounting are addressed" },
  { key: "site", label: "Shading, mounting and site conditions are considered or flagged for survey" },
  { key: "models", label: "Exact product models and specification revisions are recorded" },
  { key: "stock", label: "Relevant stock has been checked" },
  { key: "limits", label: "Warnings and limitations are documented" }
] as const;

export type PricedLine = {
  kind: "product" | "service";
  quantity: number;
  unitPriceMinor: number;
  floorUnitMinor?: number;
};

export function lineTotal(line: { quantity: number; unitPriceMinor: number }) {
  return line.quantity * line.unitPriceMinor;
}

/** Tax is rounded half-up to a whole minor unit using exact integer maths. */
export function computeTotals(lines: PricedLine[], taxBps: number) {
  const subtotalMinor = lines.reduce((sum, l) => sum + lineTotal(l), 0);
  const taxMinor = Number((BigInt(subtotalMinor) * BigInt(taxBps) + BigInt(5_000)) / BigInt(10_000));
  return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

export function belowFloor(line: PricedLine) {
  return line.floorUnitMinor !== undefined && line.unitPriceMinor < line.floorUnitMinor;
}

/** A manager must approve prices below the floor and any unusual (free-text) terms. */
export function needsCommercialApproval(lines: PricedLine[], customTerms: string | undefined) {
  return lines.some(belowFloor) || Boolean(customTerms?.trim());
}

export function validateLineInputs(lines: { quantity: number; unitPriceMinor: number; description: string }[]) {
  if (lines.length === 0) throw new ConvexError("Add at least one line.");
  if (lines.length > 60) throw new ConvexError("A quotation can have at most 60 lines.");
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 100_000) {
      throw new ConvexError(`${l.description}: quantity must be a whole number from 1 to 100,000.`);
    }
    if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0 || l.unitPriceMinor > 10_000_000_000_000) {
      throw new ConvexError(`${l.description}: price must be zero or more.`);
    }
  }
}
