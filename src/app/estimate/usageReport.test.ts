import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { buildUsageReport } from "./usageReport";

const base = {
  companyName: "Acme Solar",
  customerType: "Home (residential)",
  currency: "UGX",
  exponent: 0,
  rateMinorPerKwh: 779,
  dailyKwh: 2.5,
  peakW: 900
};

describe("usage report PDF", () => {
  test("builds for an appliance list, including many rows across pages", async () => {
    const lines = Array.from({ length: 45 }, (_, i) => ({
      name: `Fridge (Medium (150–300 L)) ${i} “test” ×`, powerW: 150, quantity: 1, hoursPerDay: 24, duty: 0.4
    }));
    const bytes = await buildUsageReport({ ...base, basis: "appliances", lines });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  test("adds a page with the recommended options when there are any", async () => {
    const options = Array.from({ length: 3 }, (_, i) => ({
      title: `Option “${i}”`, blurb: "Solar plus a battery. ".repeat(12),
      components: ["3 x Solar panels: FELICITY EM450W (450 W each)", "1 x Inverter: SRNE HF2430S60-108 (3000 W)"],
      figures: ["Solar 1.35 kW, about 4.05 kWh a day"], notes: ["A technician will confirm a few technical details."]
    }));
    const without = await buildUsageReport({ ...base, basis: "bill", lines: [] });
    const withOptions = await buildUsageReport({ ...base, basis: "bill", lines: [], options });
    expect((await PDFDocument.load(withOptions)).getPageCount()).toBe((await PDFDocument.load(without)).getPageCount() + 1);
  });

  test("builds for a bill, and without a price", async () => {
    const bytes = await buildUsageReport({ ...base, basis: "bill", lines: [], rateMinorPerKwh: null });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
});
