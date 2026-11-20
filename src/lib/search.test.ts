import { describe, expect, test } from "vitest";
import { countInto, matchesWords, searchWords, suggestionsFor } from "./search";

const has = (text: string, term: string) => matchesWords(text, searchWords(term));

describe("catalogue search", () => {
  test("matches the start of words, ignoring case and plurals", () => {
    expect(has("Solar panels", "solar")).toBe(true);
    expect(has("Solar panels", "sol")).toBe(true);
    expect(has("Solar panels", "panel")).toBe(true);
    expect(has("Lithium battery 48V 100Ah", "batteries")).toBe(true);
    expect(has("Lithium battery 48V 100Ah", "lithium 48v")).toBe(true);
    expect(has("Hybrid inverter 6kW 48V", "inverters")).toBe(true);
    expect(has("Solar panels", "lar")).toBe(false);
    expect(has("Lithium battery 48V", "lithium 24v")).toBe(false);
  });

  test("finds model codes inside a word", () => {
    expect(has("DEYE SUN-5K-SG04LP1-EU", "sg04")).toBe(true);
  });

  test("suggests the group first, then brands, then product names", () => {
    const all = [
      ...countInto("product", [{ value: "Solar panel 550W" }, { value: "Solar panel 550W" }, { value: "Solar street light 100W" }]),
      ...countInto("category", [{ value: "pv", label: "Solar panels" }]),
      ...countInto("brand", [{ value: "SOLARTHON" }])
    ];
    const shown = suggestionsFor("solar", all);
    expect(shown.map((s) => s.label)).toEqual(["Solar panels", "SOLARTHON", "Solar panel 550W", "Solar street light 100W"]);
    expect(shown[2].count).toBe(2);
    expect(suggestionsFor("", all)).toEqual([]);
  });
});
