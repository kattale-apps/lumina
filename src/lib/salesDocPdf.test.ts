import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { buildSalesDocPdf } from "./salesDocPdf";

describe("invoice and receipt PDF", () => {
  test("draws a proforma invoice with items, instalments and balance", async () => {
    const bytes = await buildSalesDocPdf({
      kind: "receipt", number: "RC-0007", sellerName: "Lumina Solar Power", sellerPhone: "+256 781 580495", sellerEmail: "sales@example.com",
      buyer: { name: "Grace Buyer", location: "Entebbe", contact: "0772 123456" },
      items: [
        { description: "Lithium battery 12V 200Ah", quantity: 2, unitPriceMinor: 870_000 },
        { description: "Hybrid inverter 3.6kW 24V – with a long description that wraps onto a second line in the table", quantity: 1, unitPriceMinor: 1_102_500 }
      ],
      currency: "UGX", exponent: 0, totalMinor: 2_842_500,
      payments: [{ amountMinor: 1_000_000, paidAt: Date.UTC(2026, 10, 1) }, { amountMinor: 500_000, paidAt: null }],
      paymentMethod: "Mobile money", notes: "Delivery to Entebbe included.", createdAt: Date.UTC(2026, 10, 24, 9, 30), preparedBy: "Sarah"
    });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    if (process.env.SALES_PDF_OUT) writeFileSync(process.env.SALES_PDF_OUT, bytes);
  });
});
