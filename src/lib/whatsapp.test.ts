import { PDFDocument } from "pdf-lib";
import { describe, expect, test } from "vitest";
import { buildRecommendationPdf } from "../app/dashboard/leads/[id]/recommendationPdf";
import { whatsappDigits, whatsappLink } from "./whatsapp";

describe("WhatsApp numbers", () => {
  test("turns local and international numbers into digits WhatsApp accepts", () => {
    expect(whatsappDigits("+256 700 123456")).toBe("256700123456");
    expect(whatsappDigits("0700 123456")).toBe("256700123456");
    expect(whatsappDigits("00256-700-123456")).toBe("256700123456");
    expect(whatsappDigits("(+254) 712 345678")).toBe("254712345678");
    expect(whatsappDigits("12345")).toBeNull();
    expect(whatsappDigits("")).toBeNull();
    expect(whatsappDigits(undefined)).toBeNull();
  });

  test("builds a click-to-chat link with the message typed in", () => {
    expect(whatsappLink("256700123456", "Hello & thanks\nLine 2")).toBe("https://wa.me/256700123456?text=Hello%20%26%20thanks%0ALine%202");
  });
});

// A 1x1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

describe("recommendation PDF", () => {
  test("builds with options, parts, prices and photos, across pages when long", async () => {
    const option = (n: number) => ({
      title: `${n} kVA hybrid with “battery” — ×`,
      description: "Runs the fridge, lights and TV through outages. ".repeat(4),
      parts: Array.from({ length: 8 }, (_, i) => ({ name: `Part ${i} 550 W panel`, quantity: i + 1 })),
      price: n === 2 ? null : "UGX 5,136,000",
      photoUrls: [PNG, PNG, "not-a-url"]
    });
    const bytes = await buildRecommendationPdf({
      companyName: "Acme Solar", customerName: "Kats Musumba", location: "Kampala", phone: "+256 782 872796",
      reference: "ABC123", preparedBy: "Tech One", needs: "about 4.2 kWh a day", message: "Hello Kats,\nhere is what we recommend.",
      options: [option(3), option(2), option(5)]
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
    expect(doc.getTitle()).toBe("Solar recommendation for Kats Musumba");
  });
});
