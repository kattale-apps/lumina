import { currencyExponent, formatMinorUnits } from "../../../convex/lib/money";

export const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  illustrative: "Illustrative — unverified",
  submitted_for_technical_review: "Submitted for technical review",
  under_technical_review: "Under technical review",
  revision_required: "Revision required",
  rejected: "Rejected",
  pending_commercial_approval: "Awaiting commercial approval",
  ready_for_official_issue: "Approved — ready to issue",
  officially_issued: "Official quotation issued",
  expired: "Expired",
  withdrawn: "Withdrawn"
};

export const STATUS_HELP: Record<string, string> = {
  draft: "Being prepared. Not yet checked by anyone.",
  illustrative: "An unverified copy has been produced for discussion. It is not an offer.",
  submitted_for_technical_review: "Waiting for a technician to pick it up.",
  under_technical_review: "A technician is checking the design.",
  revision_required: "Sent back with a reason. Change it and resubmit.",
  rejected: "Declined. It cannot be issued.",
  pending_commercial_approval: "Technically approved. A manager must approve the price or terms.",
  ready_for_official_issue: "All required approvals are in place for this exact revision.",
  officially_issued: "A controlled document with stock held until its validity ends.",
  expired: "The validity period ended and the stock hold was released.",
  withdrawn: "Cancelled. Any stock hold was released."
};

export function money(minor: number, currency: string) {
  const digits = currencyExponent(currency);
  return `${currency} ${Number(formatMinorUnits(minor, currency)).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

export const toMinor = (amount: string, currency: string) =>
  Math.round(Number(amount) * 10 ** currencyExponent(currency));
export const fromMinor = (minor: number, currency: string) => formatMinorUnits(minor, currency);
