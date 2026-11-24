import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** A proforma invoice or receipt as stored (see convex/salesDocuments.ts). */
export type SalesDocPdfData = {
  kind: "proforma" | "receipt";
  number: string;
  sellerName: string;
  sellerPhone: string | null;
  sellerEmail: string | null;
  buyer: { name: string; location: string; contact: string };
  items: { description: string; quantity: number; unitPriceMinor: number }[];
  currency: string;
  exponent: number;
  totalMinor: number;
  /** Payments recorded with proofs, for instalments. */
  payments: { amountMinor: number; paidAt: number | null }[];
  paymentMethod: string | null;
  notes: string | null;
  createdAt: number;
  preparedBy: string;
};

// Standard PDF fonts only cover Latin-1 characters; replace anything else.
function safe(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/×/g, "x")
    .replace(/[•·]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number) {
  const out: string[] = [];
  for (const paragraph of safe(text).split(/\n/)) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export function formatMoney(minor: number, exponent: number, currency: string) {
  return `${currency} ${(minor / 10 ** exponent).toLocaleString("en-US", { minimumFractionDigits: exponent, maximumFractionDigits: exponent })}`;
}

const GREEN = rgb(0.09, 0.42, 0.29);
const INK = rgb(0.09, 0.16, 0.14);
const MUTED = rgb(0.39, 0.45, 0.43);
const LINE = rgb(0.85, 0.89, 0.87);

/** Draws the document on A4 pages and returns the PDF bytes. */
export async function buildSalesDocPdf(d: SalesDocPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const title = d.kind === "proforma" ? "PROFORMA INVOICE" : "RECEIPT";
  pdf.setTitle(`${title} ${d.number}`);
  pdf.setAuthor(safe(d.sellerName));

  const W = 595;
  const H = 842;
  const M = 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const money = (minor: number) => formatMoney(minor, d.exponent, d.currency);
  const text = (t: string, x: number, size = 10, f = font, color = INK) => page.drawText(safe(t), { x, y, size, font: f, color });
  const right = (t: string, xRight: number, size = 10, f = font, color = INK) =>
    page.drawText(safe(t), { x: xRight - f.widthOfTextAtSize(safe(t), size), y, size, font: f, color });
  const newPageIfNeeded = (space: number) => {
    if (y - space < M + 40) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };

  // Header: the selling company and the document title.
  text(d.sellerName, M, 18, bold, GREEN);
  right(title, W - M, 16, bold);
  y -= 18;
  const contacts = [d.sellerPhone, d.sellerEmail].filter(Boolean).join("  ·  ");
  if (contacts) text(contacts, M, 9, font, MUTED);
  right(`No. ${d.number}`, W - M, 10, bold);
  y -= 14;
  const when = new Date(d.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
  right(`Date: ${when}`, W - M, 9, font, MUTED);
  y -= 12;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: LINE });
  y -= 22;

  // Buyer.
  text(d.kind === "proforma" ? "BILL TO" : "RECEIVED FROM", M, 9, bold, MUTED);
  y -= 15;
  text(d.buyer.name, M, 12, bold);
  y -= 15;
  text(d.buyer.location, M, 10);
  y -= 13;
  text(d.buyer.contact, M, 10);
  y -= 26;

  // Items table.
  // Right edges of the number columns, with room for "UGX 10,000,000" in each.
  const cols = { item: M, qty: 318, unit: 432, total: W - M };
  page.drawRectangle({ x: M - 6, y: y - 6, width: W - 2 * M + 12, height: 22, color: rgb(0.94, 0.97, 0.95) });
  text("ITEM", cols.item, 9, bold, MUTED);
  right("QTY", cols.qty, 9, bold, MUTED);
  right("UNIT PRICE", cols.unit, 9, bold, MUTED);
  right("AMOUNT", cols.total, 9, bold, MUTED);
  y -= 24;
  for (const it of d.items) {
    const lines = wrap(it.description, font, 10, cols.qty - cols.item - 34);
    newPageIfNeeded(lines.length * 13 + 10);
    const top = y;
    lines.forEach((l, i) => {
      y = top - i * 13;
      text(l, cols.item, 10);
    });
    y = top;
    right(String(it.quantity), cols.qty, 10);
    right(money(it.unitPriceMinor), cols.unit, 10);
    right(money(it.unitPriceMinor * it.quantity), cols.total, 10);
    y = top - lines.length * 13 - 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.5, color: LINE });
    y -= 10;
  }

  // Totals.
  newPageIfNeeded(90);
  y -= 4;
  right("TOTAL", cols.unit, 11, bold);
  right(money(d.totalMinor), cols.total, 12, bold, GREEN);
  y -= 18;
  const paid = d.payments.reduce((s, p) => s + p.amountMinor, 0);
  if (d.payments.length) {
    for (const p of d.payments) {
      newPageIfNeeded(16);
      const on = p.paidAt ? new Date(p.paidAt).toLocaleDateString("en-GB", { dateStyle: "medium" }) : "";
      right(`Paid${on ? ` ${on}` : ""}`, cols.unit, 10, font, MUTED);
      right(money(p.amountMinor), cols.total, 10);
      y -= 14;
    }
    right("BALANCE", cols.unit, 11, bold);
    right(money(Math.max(d.totalMinor - paid, 0)), cols.total, 11, bold);
    y -= 18;
  }
  if (d.kind === "receipt" && d.paymentMethod) {
    text(`Payment method: ${d.paymentMethod}`, M, 10);
    y -= 16;
  }
  if (d.notes) {
    y -= 6;
    for (const l of wrap(`Notes: ${d.notes}`, font, 10, W - 2 * M)) {
      newPageIfNeeded(14);
      text(l, M, 10);
      y -= 13;
    }
  }

  // Footer.
  y -= 18;
  newPageIfNeeded(40);
  const closing =
    d.kind === "proforma"
      ? "This is a proforma invoice, not a receipt. Prices are as offered on the date above and are confirmed on payment."
      : paid > 0 && paid < d.totalMinor
        ? "Received with thanks. The balance above remains to be paid."
        : "Received with thanks.";
  for (const l of wrap(closing, font, 9, W - 2 * M)) {
    text(l, M, 9, font, MUTED);
    y -= 12;
  }
  y -= 6;
  text(`Prepared by ${d.preparedBy}`, M, 9, font, MUTED);
  return await pdf.save();
}
