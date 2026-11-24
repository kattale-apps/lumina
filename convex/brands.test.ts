import { describe, expect, test } from "vitest";
import { brandKey, inScope, scopeFor } from "./lib/brands";

const m = (role: string, allowedBrands?: string[], status = "active") =>
  ({ role, allowedBrands, status }) as never;
const list = (s: Set<string> | null) => (s === null ? null : [...s].sort());

describe("which brands staff may see", () => {
  test("brands match whatever their capitals and spacing", () => {
    expect(brandKey("  LUMINA ")).toBe("lumina");
    expect(brandKey("LC   Star")).toBe("lc star");
    expect(inScope(new Set(["lumina"]), { brand: "Lumina" })).toBe(true);
    expect(inScope(new Set(["lumina"]), { brand: "STAR" })).toBe(false);
    expect(inScope(null, { brand: "STAR" })).toBe(true);
  });

  test("admins, inventory and technicians see every brand", () => {
    for (const role of ["super_admin", "inventory_admin", "technician"]) expect(scopeFor(m(role, ["lumina"]))).toBeNull();
  });

  test("a manager sees Lumina until brands are chosen, then exactly those", () => {
    expect(list(scopeFor(m("sales_manager")))).toEqual(["lumina"]);
    expect(list(scopeFor(m("sales_manager", ["star", "felicity"])))).toEqual(["felicity", "star"]);
  });

  test("an agent without a manager sees Lumina until brands are chosen", () => {
    expect(list(scopeFor(m("sales_agent")))).toEqual(["lumina"]);
    expect(list(scopeFor(m("sales_agent", ["star"])))).toEqual(["star"]);
  });

  test("an agent follows their manager, and can only be narrowed", () => {
    const manager = m("sales_manager", ["lumina", "star", "felicity"]);
    expect(list(scopeFor(m("sales_agent"), manager))).toEqual(["felicity", "lumina", "star"]);
    expect(list(scopeFor(m("sales_agent", ["star"]), manager))).toEqual(["star"]);
    // A brand the manager loses disappears for the agent too.
    expect(list(scopeFor(m("sales_agent", ["star", "deye"]), manager))).toEqual(["star"]);
    // A manager with nothing chosen means Lumina for the whole team.
    expect(list(scopeFor(m("sales_agent"), m("sales_manager")))).toEqual(["lumina"]);
  });

  test("a suspended manager no longer shapes the agent's brands", () => {
    expect(list(scopeFor(m("sales_agent"), m("sales_manager", ["star"], "suspended")))).toEqual(["lumina"]);
  });
});
