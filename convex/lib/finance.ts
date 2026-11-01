import { ConvexError } from "convex/values";

/** Rounds `amount * bps / 10_000` half-up, in exact integer maths. */
export function applyBps(amountMinor: number, bps: number) {
  return Number((BigInt(amountMinor) * BigInt(bps) + BigInt(5_000)) / BigInt(10_000));
}

export function validateCommissionBps(bps: number) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 5000) {
    throw new ConvexError("The commission rate must be between 0% and 50%.");
  }
  return bps;
}

export type InstallmentMethod = "flat" | "reducing";

export type InstallmentInput = {
  /** What the customer would pay in cash, including tax. */
  priceMinor: number;
  depositMinor: number;
  termMonths: number;
  /** Annual interest rate in basis points (1200 = 12%). */
  annualRateBps: number;
  method: InstallmentMethod;
};

export type InstallmentRow = {
  number: number;
  /** Months after the start date. */
  dueInMonths: number;
  paymentMinor: number;
  interestMinor: number;
  principalMinor: number;
  balanceMinor: number;
};

export type InstallmentPlan = {
  financedMinor: number;
  totalInterestMinor: number;
  totalPayableMinor: number;
  rows: InstallmentRow[];
};

export const MAX_TERM_MONTHS = 60;

export function validateInstallmentInput(i: InstallmentInput) {
  const whole = (n: number) => Number.isInteger(n) && n >= 0;
  if (!whole(i.priceMinor) || i.priceMinor < 1) throw new ConvexError("The price must be more than zero.");
  if (!whole(i.depositMinor)) throw new ConvexError("The deposit must be zero or more.");
  if (i.depositMinor >= i.priceMinor) throw new ConvexError("The deposit must be less than the price.");
  if (!Number.isInteger(i.termMonths) || i.termMonths < 1 || i.termMonths > MAX_TERM_MONTHS) {
    throw new ConvexError(`The term must be 1 to ${MAX_TERM_MONTHS} months.`);
  }
  if (!whole(i.annualRateBps) || i.annualRateBps > 10_000) {
    throw new ConvexError("The yearly rate must be between 0% and 100%.");
  }
  if (i.method !== "flat" && i.method !== "reducing") throw new ConvexError("Unknown interest method.");
}

/**
 * Builds a repayment schedule. This is an illustration for conversations with
 * a customer, not a credit offer: no lending policy is configured yet.
 *
 * - flat: interest = financed amount x yearly rate x years, spread evenly.
 * - reducing: equal payments, interest charged on the outstanding balance.
 *
 * Every figure is a whole minor unit. Rounding differences are absorbed by the
 * final instalment so that the principal repaid is exactly the amount financed.
 */
export function buildInstallmentPlan(input: InstallmentInput): InstallmentPlan {
  validateInstallmentInput(input);
  const financed = input.priceMinor - input.depositMinor;
  const n = input.termMonths;
  const rows: InstallmentRow[] = [];
  let balance = financed;

  if (input.method === "flat") {
    const totalInterest = applyBps(Math.round((financed * n) / 12), input.annualRateBps);
    const total = financed + totalInterest;
    const payment = Math.floor(total / n);
    const principalEach = Math.floor(financed / n);
    for (let k = 1; k <= n; k++) {
      const last = k === n;
      const principal = last ? balance : principalEach;
      const paymentMinor = last ? total - payment * (n - 1) : payment;
      balance -= principal;
      rows.push({
        number: k,
        dueInMonths: k,
        paymentMinor,
        principalMinor: principal,
        interestMinor: paymentMinor - principal,
        balanceMinor: balance
      });
    }
  } else {
    const monthly = input.annualRateBps / 10_000 / 12;
    const level =
      monthly === 0 ? financed / n : (financed * monthly) / (1 - Math.pow(1 + monthly, -n));
    for (let k = 1; k <= n; k++) {
      const interest = Math.round(balance * monthly);
      const last = k === n;
      const principal = last ? balance : Math.min(balance, Math.round(level) - interest);
      const paymentMinor = principal + interest;
      balance -= principal;
      rows.push({
        number: k,
        dueInMonths: k,
        paymentMinor,
        principalMinor: principal,
        interestMinor: interest,
        balanceMinor: balance
      });
    }
  }

  const totalInterestMinor = rows.reduce((s, r) => s + r.interestMinor, 0);
  return {
    financedMinor: financed,
    totalInterestMinor,
    totalPayableMinor: financed + totalInterestMinor,
    rows
  };
}

export type InstallationStatus = "pending" | "scheduled" | "in_progress" | "completed" | "cancelled";

export const INSTALLATION_TRANSITIONS: Record<InstallationStatus, InstallationStatus[]> = {
  pending: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["pending", "in_progress", "cancelled"],
  in_progress: ["completed", "scheduled", "cancelled"],
  completed: [],
  cancelled: []
};

export function assertInstallationMove(from: InstallationStatus, to: InstallationStatus) {
  if (!INSTALLATION_TRANSITIONS[from].includes(to)) {
    throw new ConvexError(`An installation cannot move from "${from}" to "${to}".`);
  }
}

/** Adds whole calendar months in UTC, clamping to the end of a shorter month. */
export function addMonths(timestamp: number, months: number) {
  const d = new Date(timestamp);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.getTime();
}
