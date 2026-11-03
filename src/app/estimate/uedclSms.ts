/**
 * Reads UEDCL token payment messages that a customer pastes from their phone.
 *
 * The official format (sender "UEDCL") is:
 *   Dear Customer, payment of 2,000.00 for a/c 14532984490 received by UEDCL.
 *   Token no. 38482428719499104113, Units 2.20 KWh.Thank you for paying.
 *
 * Everything happens in the browser. Token numbers are used only to drop
 * messages pasted twice; they are never shown in full or sent anywhere.
 */

export type Purchase = {
  amount: number;
  units: number;
  account: string;
  /** Last 4 digits of the token, for display and duplicate detection only. */
  tokenTail: string | null;
  date: Date | null;
};

export type ParsedSms = {
  purchases: Purchase[];
  duplicates: number;
  /** Messages that look like UEDCL payments but could not be read. */
  unreadable: number;
  accounts: string[];
};

const MESSAGE =
  /payment\s+of\s+(?:UGX|USh|Shs?\.?)?\s*([\d,]+(?:\.\d+)?)\s+for\s+a\/?c\.?\s*(?:no\.?)?\s*(\d{6,20})[\s\S]{0,80}?(?:token\s*(?:no\.?|number)?\s*:?\s*([\d][\d\s-]{14,32}\d))?[\s\S]{0,20}?units?\s*:?\s*([\d,]+(?:\.\d+)?)\s*kwh/gi;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const num = (s: string) => Number(s.replace(/,/g, ""));

function monthIndex(word: string) {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase());
}

/** A whole-year guess for dates written without one, never in the future. */
function withYear(month: number, day: number, year: number | null, now: Date) {
  if (year !== null) return new Date(year < 100 ? 2000 + year : year, month, day);
  const guess = new Date(now.getFullYear(), month, day);
  return guess.getTime() > now.getTime() + 86_400_000 ? new Date(now.getFullYear() - 1, month, day) : guess;
}

function valid(d: Date, month: number, day: number) {
  return d.getMonth() === month && d.getDate() === day ? d : null;
}

/** The last date written in a piece of text, if any. Day-first, as used in Uganda. */
export function findDate(text: string, now = new Date()): Date | null {
  type Hit = { at: number; date: Date };
  const hits: Hit[] = [];
  const push = (at: number, d: Date | null) => {
    if (d) hits.push({ at, date: d });
  };

  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    push(m.index!, valid(new Date(y, mo, d), mo, d));
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    push(m.index!, valid(withYear(mo, d, y, now), mo, d));
  }
  // "Oct 25", "October 25, 2026", "Sunday, Oct 25"
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/g)) {
    const mo = monthIndex(m[1]);
    if (mo < 0 || !MONTHS.some((p) => m[1].toLowerCase().startsWith(p))) continue;
    const d = Number(m[2]);
    push(m.index!, valid(withYear(mo, d, m[3] ? Number(m[3]) : null, now), mo, d));
  }
  // "25 Oct", "25 October 2026"
  for (const m of text.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?(?:,?\s+(\d{4}))?\b/g)) {
    const mo = monthIndex(m[2]);
    if (mo < 0 || !MONTHS.some((p) => m[2].toLowerCase().startsWith(p))) continue;
    const d = Number(m[1]);
    push(m.index!, valid(withYear(mo, d, m[3] ? Number(m[3]) : null, now), mo, d));
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.at - b.at);
  return hits[hits.length - 1].date;
}

export function parseUedclSms(text: string, now = new Date()): ParsedSms {
  const purchases: Purchase[] = [];
  const seenTokens = new Set<string>();
  let duplicates = 0;
  let lastEnd = 0;
  let matched = 0;

  for (const m of text.matchAll(MESSAGE)) {
    matched++;
    const amount = num(m[1]);
    const units = num(m[4]);
    const token = m[3]?.replace(/\D/g, "") ?? null;
    // A date copied with the message sits just before it (e.g. "Sunday, Oct 25 • 12:20 AM").
    const date = findDate(text.slice(lastEnd, m.index!), now);
    lastEnd = m.index! + m[0].length;
    if (!(amount > 0) || !(units > 0)) continue;
    if (token) {
      if (seenTokens.has(token)) {
        duplicates++;
        continue;
      }
      seenTokens.add(token);
    }
    purchases.push({ amount, units, account: m[2], tokenTail: token ? token.slice(-4) : null, date });
  }

  const looksLikePayment = (text.match(/payment\s+of/gi) ?? []).length;
  const allDated = purchases.length > 0 && purchases.every((p) => p.date);
  if (allDated) purchases.sort((a, b) => a.date!.getTime() - b.date!.getTime());

  return {
    purchases,
    duplicates,
    unreadable: Math.max(0, looksLikePayment - matched),
    accounts: [...new Set(purchases.map((p) => p.account))]
  };
}

export type Projection = {
  kwh: { day: number; week: number; month: number; year: number };
  /** In UGX at the price the customer actually paid. */
  cost: { day: number; week: number; month: number; year: number };
};

export type SmsSummary = {
  /** Units, amount and days to send to the bill calculation. */
  units: number;
  amount: number;
  days: number | null;
  /** "dates": from message dates. "per_top_up": from how long one top-up lasts. */
  basis: "dates" | "per_top_up";
  payments: number;
  totalUnits: number;
  totalAmount: number;
  /** A typical top-up: the average of the pasted payments. */
  typicalUnits: number;
  typicalAmount: number;
  pricePerUnit: number | null;
  firstDate: Date | null;
  lastDate: Date | null;
  /** Null until there is a time span to project from. */
  projection: Projection | null;
};

const DAY = 86_400_000;
export const DAYS_PER_WEEK = 7;
export const DAYS_PER_MONTH = 30; // matches the rest of the power check
export const DAYS_PER_YEAR = 365;

function project(dailyKwh: number, pricePerUnit: number | null): Projection {
  const price = pricePerUnit ?? 0;
  const k = (d: number) => round2(dailyKwh * d);
  const c = (d: number) => Math.round(dailyKwh * d * price);
  return {
    kwh: { day: k(1), week: k(DAYS_PER_WEEK), month: k(DAYS_PER_MONTH), year: k(DAYS_PER_YEAR) },
    cost: { day: c(1), week: c(DAYS_PER_WEEK), month: c(DAYS_PER_MONTH), year: c(DAYS_PER_YEAR) }
  };
}

/**
 * Projects use and spend from as few as one payment.
 *
 * With dates on two or more messages: the time from the first purchase to the
 * latest, leaving out the latest purchase (those units are still on the meter).
 * Otherwise: the customer says how many days one top-up usually lasts, and the
 * typical top-up is spread over that many days.
 */
export function summarisePurchases(purchases: Purchase[], daysPerTopUp: number | null): SmsSummary {
  const n = purchases.length;
  const totalUnits = purchases.reduce((s, p) => s + p.units, 0);
  const totalAmount = purchases.reduce((s, p) => s + p.amount, 0);
  const pricePerUnit = totalUnits > 0 ? totalAmount / totalUnits : null;
  const base = {
    payments: n,
    totalUnits: round2(totalUnits),
    totalAmount: Math.round(totalAmount),
    typicalUnits: n ? round2(totalUnits / n) : 0,
    typicalAmount: n ? Math.round(totalAmount / n) : 0,
    pricePerUnit
  };

  const dated = n >= 2 && purchases.every((p) => p.date);
  const first = dated ? purchases[0].date! : null;
  const last = dated ? purchases[n - 1].date! : null;
  const spanDays = first && last ? Math.round((last.getTime() - first.getTime()) / DAY) : 0;

  if (dated && spanDays >= 1) {
    const used = purchases.slice(0, -1);
    const units = used.reduce((s, p) => s + p.units, 0);
    const amount = used.reduce((s, p) => s + p.amount, 0);
    return {
      ...base,
      units: round2(units),
      amount: Math.round(amount),
      days: spanDays,
      basis: "dates",
      firstDate: first,
      lastDate: last,
      // Priced at what was paid for these same units, as the server does.
      projection: project(units / spanDays, units > 0 ? amount / units : pricePerUnit)
    };
  }

  const ok = daysPerTopUp !== null && Number.isFinite(daysPerTopUp) && daysPerTopUp > 0 && n > 0;
  return {
    ...base,
    units: round2(totalUnits),
    amount: Math.round(totalAmount),
    // n top-ups, each lasting daysPerTopUp: the same daily rate the projection shows.
    days: ok ? round2(daysPerTopUp * n) : null,
    basis: "per_top_up",
    firstDate: null,
    lastDate: null,
    projection: ok ? project(totalUnits / n / daysPerTopUp, pricePerUnit) : null
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
