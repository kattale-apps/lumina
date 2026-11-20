import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";

/** One option as the technician has written it. */
export type PdfOption = {
  title: string;
  description: string;
  parts: { name: string; quantity: number }[];
  /** Already formatted, e.g. "UGX 5,136,000", or null for "price on request". */
  price: string | null;
  photoUrls: string[];
};

export type RecommendationPdfData = {
  companyName: string;
  customerName: string;
  location: string;
  phone: string;
  reference: string;
  preparedBy: string | null;
  /** e.g. "about 4.2 kWh a day, busiest moment about 1,800 W"; omitted for upgrade requests. */
  needs: string | null;
  message: string;
  options: PdfOption[];
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

/** Photo bytes from the app's storage, as a PDF image (JPEG or PNG), or null if it cannot be used. */
async function loadPhoto(pdf: PDFDocument, url: string): Promise<PDFImage | null> {
  try {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await pdf.embedJpg(bytes);
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await pdf.embedPng(bytes);
  } catch {
    // A photo that cannot be fetched is left out rather than failing the whole PDF.
  }
  return null;
}

/** A one-page-per-few-options PDF the technician can share with the customer, e.g. on WhatsApp. */
export async function buildRecommendationPdf(data: RecommendationPdfData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Solar recommendation for ${safe(data.customerName)}`);
  pdf.setProducer("Solar Switch");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const W = 595; // A4 portrait
  const H = 842;
  const M = 42;
  const width = W - 2 * M;
  const ink = rgb(0.09, 0.16, 0.14);
  const muted = rgb(0.39, 0.45, 0.43);
  const green = rgb(0.09, 0.42, 0.29);
  const panel = rgb(0.94, 0.97, 0.95);
  const line = rgb(0.86, 0.9, 0.88);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const room = (needed: number) => {
    if (y - needed < M + 24) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (t: string, x: number, size: number, f = font, color = ink) => page.drawText(safe(t), { x, y, size, font: f, color });
  const para = (t: string, size = 10, f = font, color = ink, indent = 0) => {
    for (const l of wrap(t, f, size, width - indent)) {
      room(size + 4);
      text(l, M + indent, size, f, color);
      y -= size + 4;
    }
  };

  // Header
  text("SOLAR RECOMMENDATION", M, 9, bold, green);
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  page.drawText(date, { x: W - M - font.widthOfTextAtSize(date, 9), y, size: 9, font, color: muted });
  y -= 24;
  text(data.companyName, M, 20, bold);
  y -= 22;
  para(`Prepared for ${data.customerName}, ${data.location} (${data.phone})`, 10, font, muted);
  para(`Reference ${data.reference}${data.preparedBy ? ` - prepared by ${data.preparedBy}` : ""}`, 10, font, muted);
  if (data.needs) para(`Your energy needs: ${data.needs}`, 10, font, muted);
  y -= 8;
  if (data.message.trim()) {
    para(data.message, 11);
    y -= 8;
  }

  for (const [i, o] of data.options.entries()) {
    room(80);
    page.drawRectangle({ x: M, y: y - 8, width, height: 24, color: panel });
    text(`Option ${i + 1}: ${o.title}`, M + 8, 12.5, bold);
    y -= 30;
    if (o.description.trim()) {
      para(o.description, 10, font, muted);
      y -= 4;
    }
    if (o.parts.length) {
      room(18);
      text("What is included", M, 10, bold);
      y -= 15;
      for (const p of o.parts) para(`${p.quantity} x ${p.name}`, 10, font, ink, 10);
      y -= 4;
    }
    room(20);
    text(o.price ? `Estimated price: ${o.price}` : "Price: on request", M, 11.5, bold, green);
    y -= 20;

    // Photos, two to a row.
    const photos = (await Promise.all(o.photoUrls.slice(0, 4).map((u) => loadPhoto(pdf, u)))).filter((p): p is PDFImage => p !== null);
    const cell = (width - 12) / 2;
    for (let p = 0; p < photos.length; p += 2) {
      const row = photos.slice(p, p + 2).map((img) => img.scaleToFit(cell, 170));
      const h = Math.max(...row.map((r) => r.height));
      room(h + 10);
      row.forEach((r, k) => {
        page.drawImage(photos[p + k], { x: M + k * (cell + 12), y: y - h, width: r.width, height: r.height });
      });
      y -= h + 10;
    }
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: line });
    y -= 16;
  }

  for (const p of pdf.getPages()) {
    p.drawText(
      safe("A technician confirms the design on site before installation. Prices are estimates until confirmed in a quotation."),
      { x: M, y: 22, size: 7.5, font, color: muted }
    );
  }
  return await pdf.save();
}
