import { ConvexError } from "convex/values";

/**
 * Money is stored as integer minor units (e.g. cents) with an explicit
 * currency, never as floating-point amounts, and currencies are never mixed.
 *
 * Rounding policy: a margin is applied once to the stored cost and the result
 * is rounded half-up to the currency's minor unit.
 */

const ZERO_DECIMAL = new Set([
  "UGX", "RWF", "JPY", "KRW", "XAF", "XOF", "BIF", "CLP", "DJF", "GNF", "KMF", "PYG", "VND", "VUV", "XPF"
]);
const THREE_DECIMAL = new Set(["BHD", "KWD", "OMR", "JOD", "TND", "LYD", "IQD"]);

/** Largest amount accepted, in minor units. Keeps arithmetic safely exact. */
const MAX_MINOR = 10_000_000_000_000;
/** Margins are stored in basis points (1% = 100 bps). */
export const MAX_MARGIN_BPS = 100_000;

export function currencyExponent(currency: string) {
  if (ZERO_DECIMAL.has(currency)) return 0;
  if (THREE_DECIMAL.has(currency)) return 3;
  return 2;
}

/** Converts a human amount to minor units, refusing extra decimals instead of rounding silently. */
export function toMinorUnits(amount: number, currency: string) {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new ConvexError("Amount must be zero or more.");
  }
  const exponent = currencyExponent(currency);
  const fixed = Number(amount.toFixed(exponent));
  if (Math.abs(amount - fixed) > 1e-9) {
    throw new ConvexError(
      exponent === 0
        ? `${currency} amounts must be whole numbers.`
        : `${currency} amounts can have at most ${exponent} decimal places.`
    );
  }
  const minor = Math.round(fixed * 10 ** exponent);
  if (minor > MAX_MINOR) throw new ConvexError("Amount is too large.");
  return minor;
}

export function formatMinorUnits(minor: number, currency: string) {
  const exponent = currencyExponent(currency);
  return (minor / 10 ** exponent).toFixed(exponent);
}

/** cost × (1 + bps/10000), rounded half-up to a whole minor unit, using exact integer maths. */
export function applyMarginBps(costMinor: number, bps: number) {
  const scaled = BigInt(costMinor) * BigInt(10_000 + bps) + BigInt(5_000);
  return Number(scaled / BigInt(10_000));
}

export function validateMarginBps(bps: number, label: string) {
  if (!Number.isInteger(bps) || bps < 0 || bps > MAX_MARGIN_BPS) {
    throw new ConvexError(`${label} must be between 0% and ${MAX_MARGIN_BPS / 100}%.`);
  }
  return bps;
}
