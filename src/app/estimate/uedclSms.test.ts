import { describe, expect, test } from "vitest";
import { findDate, parseUedclSms, summarisePurchases } from "./uedclSms";

const NOW = new Date(2026, 10, 3); // 3 Nov 2026

const msg = (amount: string, token: string, units: string) =>
  `Dear Customer, payment of ${amount} for a/c 14532984490 received by UEDCL. Token no. ${token}, Units ${units} KWh.Thank you for paying.`;

describe("UEDCL SMS import", () => {
  test("reads the official message format", () => {
    const parsed = parseUedclSms(msg("2,000.00", "38482428719499104113", "2.20"), NOW);
    expect(parsed.purchases).toEqual([
      { amount: 2000, units: 2.2, account: "14532984490", tokenTail: "4113", date: null }
    ]);
    expect(parsed.unreadable).toBe(0);
  });

  test("reads several pasted messages, drops repeats, and keeps no full token", () => {
    const text = [
      msg("1,200.00", "29985242862982104735", "1.30"),
      msg("2,000.00", "04033809731432102309", "2.20"),
      msg("2,000.00", "04033809731432102309", "2.20"),
      msg("2,000.00", "01043539267748103816", "2.20")
    ].join("\n");
    const parsed = parseUedclSms(text, NOW);
    expect(parsed.purchases).toHaveLength(3);
    expect(parsed.duplicates).toBe(1);
    expect(JSON.stringify(parsed)).not.toContain("04033809731432102309");
    // Each top-up lasts about 2 days: 3 top-ups = 6 days.
    const s = summarisePurchases(parsed.purchases, 2);
    expect(s).toMatchObject({ basis: "per_top_up", units: 5.7, amount: 5200, days: 6, typicalUnits: 1.9, typicalAmount: 1733 });
    expect(Math.round(s.pricePerUnit!)).toBe(912);
    expect(s.projection!.kwh.day).toBe(0.95);
    expect(s.projection!.cost.month).toBe(26000); // 5,200 over 6 days x 30
  });

  test("uses dates copied with the messages and leaves out the newest purchase", () => {
    const text = [
      "Sunday, Oct 25 • 12:20 AM", msg("1,200.00", "29985242862982104735", "1.30"),
      "27/10/2026 11:37", msg("2,000.00", "04033809731432102309", "2.20"),
      "4 Nov", msg("2,000.00", "01043539267748103816", "2.20")
    ].join("\n");
    const parsed = parseUedclSms(text, new Date(2026, 10, 5));
    expect(parsed.purchases.map((p) => p.date?.getDate())).toEqual([25, 27, 4]);
    const s = summarisePurchases(parsed.purchases, null);
    expect(s).toMatchObject({ basis: "dates", days: 10, units: 3.5, amount: 3200, totalUnits: 5.7 });
    expect(s.projection!.cost.week).toBe(2240); // 3,200 over 10 days x 7
  });

  test("one message is enough for a projection", () => {
    const parsed = parseUedclSms(msg("2,000.00", "38482428719499104113", "2.20"), NOW);
    expect(summarisePurchases(parsed.purchases, null).projection).toBeNull();
    const s = summarisePurchases(parsed.purchases, 4);
    expect(s.projection).toEqual({
      kwh: { day: 0.55, week: 3.85, month: 16.5, year: 200.75 },
      cost: { day: 500, week: 3500, month: 15000, year: 182500 }
    });
    expect(s).toMatchObject({ units: 2.2, amount: 2000, days: 4 });
  });

  test("flags payment messages it cannot read and other meters", () => {
    const text = `${msg("2,000.00", "38482428719499104113", "2.20")}\nDear Customer, payment of 5,000 for something odd.\n` +
      msg("3,000.00", "11112222333344445555", "3.30").replace("14532984490", "99990000111");
    const parsed = parseUedclSms(text, NOW);
    expect(parsed.purchases).toHaveLength(2);
    expect(parsed.unreadable).toBe(1);
    expect(parsed.accounts).toHaveLength(2);
  });

  test("dates without a year are never placed in the future", () => {
    expect(findDate("Dec 30", NOW)?.getFullYear()).toBe(2025);
    expect(findDate("Oct 25", NOW)?.getFullYear()).toBe(2026);
    expect(findDate("31/02/2026", NOW)).toBeNull();
  });
});
