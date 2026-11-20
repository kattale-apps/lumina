import { describe, expect, test } from "vitest";
import { itemTypeByKey } from "../../../convex/lib/itemTypes";
import { describeItem, specsFromName } from "./describeItem";

describe("request an item helpers", () => {
  test("reads sizes out of product names", () => {
    expect(specsFromName("Lithium battery 12V 200Ah", itemTypeByKey("battery")!)).toEqual({ voltage: "12", capacity: "200" });
    expect(specsFromName("Solar panel 550W", itemTypeByKey("panel")!)).toEqual({ power: "550" });
    expect(specsFromName("Hybrid inverter 6.2kW 48V", itemTypeByKey("inverter")!)).toEqual({ power: "6.2", voltage: "48" });
    expect(specsFromName("Inverter 3000W 24V", itemTypeByKey("inverter")!)).toEqual({ power: "3", voltage: "24" });
    expect(specsFromName("MPPT charge controller 60A", itemTypeByKey("controller")!)).toEqual({ current: "60" });
  });

  test("writes an item as one line for staff and WhatsApp", () => {
    expect(describeItem({ type: "battery", subtype: "lithium", specs: [{ key: "voltage", value: "12" }, { key: "capacity", value: "200" }], quantity: 2 }))
      .toBe("2 × Battery, Lithium, 12 V, 200 Ah");
    expect(describeItem({ type: "panel", specs: [], productName: "Solar panel 550W", description: "prefer black frame", quantity: 6 }))
      .toBe("6 × Solar panel (Solar panel 550W) - prefer black frame");
    expect(describeItem({ type: "inverter", subtype: "not_sure", specs: [{ key: "power", value: "5", unit: "kW" }], quantity: 1 }))
      .toBe("1 × Inverter, 5 kW");
  });
});
