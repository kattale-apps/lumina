import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMinorUnits } from "./money";

export const ILLUSTRATIVE_BANNER = "UNVERIFIED - FOR ILLUSTRATION ONLY";

export type QuotePdfData = {
  mode: "illustrative" | "official";
  companyName: string;
  customerName: string;
  siteName: string;
  officialNumber?: string;
  revision: number;
  currency: string;
  lines: { description: string; sku?: string; quantity: number; unitPriceMinor: number }[];
  subtotalMinor: number;
  taxBps: number;
  taxMinor: number;
  totalMinor: number;
  validUntil?: number;
  notes: string[];
};

/** Standard PDF fonts only cover Latin-1; anything else is replaced rather than crashing. */
const safe = (text: string) => text.replace(/[^\x20-\x7E -ÿ]/g, "?");

const MARGIN = 48;
const PAGE = { w: 595, h: 842 };

/**
 * Builds the PDF. Every page is created through `newPage`, which draws the
 * illustrative watermark, so no page can be added without it.
 */
export async function buildQuotePdf(data: QuotePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const illustrative = data.mode === "illustrative";

  const newPage = () => {
    const page = doc.addPage([PAGE.w, PAGE.h]);
    if (illustrative) {
      page.drawText(ILLUSTRATIVE_BANNER, {
        x: 70, y: 250, size: 34, font: bold, color: rgb(0.85, 0.85, 0.85), rotate: degrees(40)
      });
      page.drawRectangle({ x: 0, y: PAGE.h - 28, width: PAGE.w, height: 28, color: rgb(0.7, 0.1, 0.1) });
      page.drawText(ILLUSTRATIVE_BANNER, { x: MARGIN, y: PAGE.h - 19, size: 11, font: bold, color: rgb(1, 1, 1) });
    }
    return page;
  };

  let page = newPage();
  let y = PAGE.h - (illustrative ? 70 : 56);
  const text = (p: PDFPage, s: string, x: number, size: number, f: PDFFont = font) =>
    p.drawText(safe(s), { x, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
  const line = (s: string, size = 10, f: PDFFont = font, gap = 15) => {
    if (y < 90) {
      page = newPage();
      y = PAGE.h - (illustrative ? 70 : 56);
    }
    text(page, s, MARGIN, size, f);
    y -= gap;
  };

  line(data.companyName, 16, bold, 22);
  line(illustrative ? "Illustrative quotation" : `Quotation ${data.officialNumber ?? ""}`, 13, bold, 20);
  line(`Customer: ${data.customerName}`);
  line(`Site: ${data.siteName}`);
  line(`Revision: ${data.revision}   Currency: ${data.currency}`);
  if (data.validUntil) line(`Valid until: ${new Date(data.validUntil).toISOString().slice(0, 10)}`);
  y -= 8;

  if (illustrative) {
    line("Technical suitability, equipment, stock, final pricing and terms remain subject to", 10, bold, 13);
    line("company verification. This is not an official offer or a stock commitment.", 10, bold, 20);
  }

  // Table header.
  const cols = { desc: MARGIN, qty: 330, unit: 400, total: 485 };
  const head = (p: PDFPage) => {
    text(p, "Description", cols.desc, 9, bold);
    text(p, "Qty", cols.qty, 9, bold);
    text(p, "Unit price", cols.unit, 9, bold);
    text(p, "Amount", cols.total, 9, bold);
  };
  head(page);
  y -= 16;
  for (const l of data.lines) {
    if (y < 90) {
      page = newPage();
      y = PAGE.h - (illustrative ? 70 : 56);
      head(page);
      y -= 16;
    }
    const desc = l.sku ? `${l.description} (${l.sku})` : l.description;
    text(page, desc.length > 52 ? `${desc.slice(0, 49)}...` : desc, cols.desc, 9);
    text(page, String(l.quantity), cols.qty, 9);
    text(page, formatMinorUnits(l.unitPriceMinor, data.currency), cols.unit, 9);
    text(page, formatMinorUnits(l.quantity * l.unitPriceMinor, data.currency), cols.total, 9);
    y -= 14;
  }

  y -= 8;
  line(`Subtotal: ${formatMinorUnits(data.subtotalMinor, data.currency)} ${data.currency}`, 10, font, 14);
  line(`Tax (${data.taxBps / 100}%): ${formatMinorUnits(data.taxMinor, data.currency)} ${data.currency}`, 10, font, 14);
  line(`Total: ${formatMinorUnits(data.totalMinor, data.currency)} ${data.currency}`, 12, bold, 20);

  for (const note of data.notes) line(note, 9, font, 13);

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(safe(`Page ${i + 1} of ${pages.length}`), { x: PAGE.w - 110, y: 24, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  });
  return await doc.save({ useObjectStreams: false });
}
