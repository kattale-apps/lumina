import {
  PDFDocument,
  StandardFonts,
  clip,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB
} from "pdf-lib";
import { drawQrCode } from "../../../lib/qrPdf";

export type CertificateData = {
  academyName: string;
  number: string;
  holderName: string;
  companyName: string;
  issuedAt: number;
  modules: { title: string; scorePercent: number }[];
  /** The holder's face photo (JPEG or PNG bytes), framed in the top-left corner. */
  photo?: Uint8Array | null;
  /** Link to the public verification page; printed as a QR code. */
  verifyUrl?: string | null;
  /** The Solar Switch logo with a transparent background: navy for the header and seal, dark for the tiled background. */
  logo?: Uint8Array | null;
  tileLogo?: Uint8Array | null;
};

// Standard PDF fonts only cover Latin-1 style characters; replace anything else.
function safe(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}

const W = 842;
const H = 595;
const NAVY = rgb(0.09, 0.17, 0.33);
const GOLD = rgb(0.8, 0.62, 0.24);
const GOLD_LIGHT = rgb(0.95, 0.81, 0.45);
const GOLD_DARK = rgb(0.62, 0.45, 0.13);
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.4, 0.43, 0.48);
const PAPER = rgb(0.995, 0.99, 0.975);
const WHITE = rgb(1, 1, 1);
const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

type Fonts = { helv: PDFFont; helvB: PDFFont; times: PDFFont; timesB: PDFFont; script: PDFFont };

/** Text with letter spacing, aligned about x. */
function spaced(page: PDFPage, raw: string, x: number, y: number, size: number, font: PDFFont, color: RGB, spacing = 0, align: "left" | "center" = "left") {
  const text = safe(raw);
  const width = [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + spacing, -spacing);
  let cx = align === "center" ? x - width / 2 : x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + spacing;
  }
}

/** Centred text that shrinks to fit, then is cut short as a last resort. */
function centred(page: PDFPage, raw: string, y: number, size: number, font: PDFFont, color: RGB, maxWidth: number, min = 10) {
  let text = safe(raw);
  let s = size;
  while (font.widthOfTextAtSize(text, s) > maxWidth && s > min) s -= 1;
  if (font.widthOfTextAtSize(text, s) > maxWidth) text = `${text.slice(0, 70)}...`;
  page.drawText(text, { x: W / 2 - font.widthOfTextAtSize(text, s) / 2, y, size: s, font, color });
}

async function embedImage(doc: PDFDocument, bytes: Uint8Array | null | undefined): Promise<PDFImage | null> {
  if (!bytes || bytes.length < 8) return null;
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  try {
    if (isPng) return await doc.embedPng(bytes);
    if (isJpeg) return await doc.embedJpg(bytes);
  } catch {
    // An unreadable image is left out rather than failing the certificate.
  }
  return null;
}

/** The logo, faint and evenly tiled across the page. */
function tile(page: PDFPage, logo: PDFImage) {
  const size = 46;
  const gap = 88;
  for (let y = 10, row = 0; y < H; y += gap, row++) {
    for (let x = (row % 2 ? gap / 2 : 0) + 8; x < W; x += gap) {
      page.drawImage(logo, { x, y, width: size, height: size, opacity: 0.06 });
    }
  }
}

/** A gold award seal with ribbon tails, the logo in the middle and lettering round the ring. */
function seal(page: PDFPage, f: Fonts, logo: PDFImage | null, cx: number, cy: number, r: number) {
  for (const dir of [-1, 1]) {
    const x0 = cx + dir * r * 0.35;
    page.drawSvgPath(
      `M ${x0 - r * 0.28} 0 L ${x0 + r * 0.28} 0 L ${x0 + r * 0.28 + dir * r * 0.18} ${r * 1.55} L ${x0 + dir * r * 0.12} ${r * 1.25} L ${x0 - r * 0.28 + dir * r * 0.18} ${r * 1.55} Z`,
      { x: 0, y: cy, color: NAVY, borderColor: GOLD_DARK, borderWidth: 0.8 }
    );
  }
  const points = 36;
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const a = (Math.PI * i) / points;
    const rr = i % 2 === 0 ? r : r * 0.9;
    d += `${i === 0 ? "M" : "L"} ${cx + rr * Math.cos(a)} ${-(rr * Math.sin(a))} `;
  }
  page.drawSvgPath(`${d}Z`, { x: 0, y: cy, color: GOLD, borderColor: GOLD_DARK, borderWidth: 0.8 });
  page.drawCircle({ x: cx, y: cy, size: r * 0.84, color: GOLD_LIGHT, borderColor: GOLD_DARK, borderWidth: 1.2 });
  page.drawCircle({ x: cx, y: cy, size: r * 0.58, color: WHITE, borderColor: GOLD_DARK, borderWidth: 1.2 });
  if (logo) {
    const ls = r * 0.82;
    page.drawImage(logo, { x: cx - ls / 2, y: cy - ls / 2 + r * 0.02, width: ls, height: ls });
  }
  const size = r * 0.135;
  const arc = (text: string, top: boolean) => {
    const R = top ? r * 0.66 : r * 0.66 + size * 0.75;
    const chars = [...text];
    const widths = chars.map((ch) => f.helvB.widthOfTextAtSize(ch, size) + size * 0.12);
    const total = widths.reduce((a, b) => a + b, 0);
    let a = top ? Math.PI / 2 + total / R / 2 : -Math.PI / 2 - total / R / 2;
    chars.forEach((ch, i) => {
      const half = widths[i] / 2 / R;
      a += top ? -half : half;
      const rot = top ? a - Math.PI / 2 : a + Math.PI / 2;
      const w = f.helvB.widthOfTextAtSize(ch, size);
      page.drawText(ch, {
        x: cx + R * Math.cos(a) - (w / 2) * Math.cos(rot),
        y: cy + R * Math.sin(a) - (w / 2) * Math.sin(rot),
        size,
        font: f.helvB,
        color: GOLD_DARK,
        rotate: degrees((rot * 180) / Math.PI)
      });
      a += top ? -half : half;
    });
  };
  arc("SOLAR SWITCH", true);
  arc("SALES ACADEMY", false);
  for (const side of [-1, 1]) page.drawCircle({ x: cx + side * r * 0.66, y: cy, size: r * 0.035, color: GOLD_DARK });
}

function signatureLine(page: PDFPage, f: Fonts, x: number, y: number, label: string, value: string, width = 170) {
  const v = safe(value);
  let s = 12;
  while (f.timesB.widthOfTextAtSize(v, s) > width && s > 8) s -= 0.5;
  page.drawText(v, { x: x + (width - f.timesB.widthOfTextAtSize(v, s)) / 2, y: y + 6, size: s, font: f.timesB, color: NAVY });
  page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.8, color: NAVY });
  spaced(page, label, x + width / 2, y - 13, 7.5, f.helvB, NAVY, 1.2, "center");
}

/**
 * A landscape A4 certificate in the "classic framed" design: navy and gold frame, the logo
 * tiled faintly behind and large at the top, the holder's photo top left, a QR code to the
 * verification page top right, and a gold seal at the bottom. It records training only and says so.
 */
export async function buildCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.academyName} certificate ${data.number}`);
  const page = doc.addPage([W, H]);
  const f: Fonts = {
    helv: await doc.embedFont(StandardFonts.Helvetica),
    helvB: await doc.embedFont(StandardFonts.HelveticaBold),
    times: await doc.embedFont(StandardFonts.TimesRoman),
    timesB: await doc.embedFont(StandardFonts.TimesRomanBold),
    script: await doc.embedFont(StandardFonts.TimesRomanBoldItalic)
  };
  const logo = await embedImage(doc, data.logo);
  const tileLogo = (await embedImage(doc, data.tileLogo)) ?? logo;
  const photo = await embedImage(doc, data.photo);

  // Paper, tiled logo and the double frame with round corner ornaments.
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });
  if (tileLogo) tile(page, tileLogo);
  page.drawRectangle({ x: 18, y: 18, width: W - 36, height: H - 36, borderColor: NAVY, borderWidth: 6 });
  page.drawRectangle({ x: 32, y: 32, width: W - 64, height: H - 64, borderColor: GOLD, borderWidth: 2 });
  page.drawRectangle({ x: 38, y: 38, width: W - 76, height: H - 76, borderColor: GOLD, borderWidth: 0.6 });
  for (const [x, y] of [[32, 32], [W - 32, 32], [32, H - 32], [W - 32, H - 32]]) {
    page.drawCircle({ x, y, size: 22, color: NAVY, borderColor: GOLD, borderWidth: 2 });
    page.drawCircle({ x, y, size: 11, color: GOLD });
  }

  // Header: logo, academy name, title.
  const cx = W / 2;
  if (logo) page.drawImage(logo, { x: cx - 42, y: H - 128, width: 84, height: 84 });
  spaced(page, data.academyName.toUpperCase(), cx, H - 140, 11, f.helvB, GOLD, 3, "center");
  centred(page, "Certificate of Completion", H - 190, 40, f.timesB, NAVY, 440);
  page.drawLine({ start: { x: cx - 160, y: H - 206 }, end: { x: cx - 20, y: H - 206 }, thickness: 1, color: GOLD });
  page.drawCircle({ x: cx, y: H - 206, size: 4, color: GOLD });
  page.drawLine({ start: { x: cx + 20, y: H - 206 }, end: { x: cx + 160, y: H - 206 }, thickness: 1, color: GOLD });

  // The holder.
  spaced(page, "THIS IS TO CERTIFY THAT", cx, H - 236, 10, f.helvB, MUTED, 2, "center");
  centred(page, data.holderName, H - 284, 46, f.script, NAVY, 420, 18);
  page.drawLine({ start: { x: cx - 200, y: H - 296 }, end: { x: cx + 200, y: H - 296 }, thickness: 1.2, color: GOLD });
  const count = data.modules.length;
  const countWord = NUMBER_WORDS[count] ?? String(count);
  centred(
    page,
    `has completed all ${countWord} modules of the ${data.academyName} and passed each assessment:`,
    H - 320, 12.5, f.times, INK, 620
  );

  // Modules in two columns.
  const blockW = 500;
  const colW = blockW / 2;
  data.modules.forEach((m, i) => {
    const x = cx - blockW / 2 + (i % 2) * colW + 6;
    const y = H - 346 - Math.floor(i / 2) * 18;
    const label = safe(`${i + 1}. ${m.title}`);
    const pct = `${m.scorePercent}%`;
    let s = 9.5;
    while (f.helv.widthOfTextAtSize(`${label}  ${pct}`, s) > colW - 12 && s > 6.5) s -= 0.5;
    page.drawText(label, { x, y, size: s, font: f.helv, color: INK });
    page.drawText(pct, { x: x + f.helv.widthOfTextAtSize(`${label}  `, s), y, size: s, font: f.helvB, color: INK });
  });

  // Photo, top left.
  if (photo) {
    const size = 104;
    const x = 66;
    const top = H - 62;
    page.drawRectangle({ x: x - 4, y: top - size - 4, width: size + 8, height: size + 8, color: GOLD });
    page.drawRectangle({ x: x - 1, y: top - size - 1, width: size + 2, height: size + 2, color: WHITE });
    // Fill the square frame, cropping the longer side evenly, clipped to the frame.
    const scale = Math.max(size / photo.width, size / photo.height);
    const w = photo.width * scale;
    const h = photo.height * scale;
    page.pushOperators(pushGraphicsState(), rectangle(x, top - size, size, size), clip(), endPath());
    page.drawImage(photo, { x: x - (w - size) / 2, y: top - size - (h - size) / 2, width: w, height: h });
    page.pushOperators(popGraphicsState());
  }

  // Certificate number and QR code, top right.
  const right = W - 118;
  spaced(page, "CERTIFICATE NO.", right, H - 100, 8.5, f.helvB, GOLD, 1.5, "center");
  spaced(page, data.number, right, H - 120, 14, f.timesB, NAVY, 1, "center");
  if (data.verifyUrl) {
    const qrSize = 68;
    drawQrCode(page, data.verifyUrl, right - qrSize / 2, H - 208, qrSize, NAVY);
    const scan = "Scan to verify";
    page.drawText(scan, { x: right - f.helv.widthOfTextAtSize(scan, 7.5) / 2, y: H - 218, size: 7.5, font: f.helv, color: MUTED });
  }

  // Seal between the date and the issuer.
  seal(page, f, logo, cx, 138, 46);
  const issued = new Date(data.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  signatureLine(page, f, 120, 92, "DATE", issued);
  signatureLine(page, f, W - 290, 92, "AWARDED BY", data.companyName);
  const note = "A record of sales training. It is not an electrical or installation qualification.";
  page.drawText(note, { x: cx - f.helv.widthOfTextAtSize(note, 7.5) / 2, y: 46, size: 7.5, font: f.helv, color: MUTED });

  return await doc.save();
}
