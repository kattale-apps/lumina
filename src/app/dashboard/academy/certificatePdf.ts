import {
  PDFDocument,
  StandardFonts,
  clip,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  type PDFFont
} from "pdf-lib";
import { drawQrCode } from "../../../lib/qrPdf";

export type CertificateData = {
  academyName: string;
  number: string;
  holderName: string;
  companyName: string;
  issuedAt: number;
  modules: { title: string; scorePercent: number }[];
  /** The holder's face photo (JPEG or PNG bytes), printed in the top corner. */
  photo?: Uint8Array | null;
  /** Link to the public verification page; printed as a QR code. */
  verifyUrl?: string | null;
};

// Standard PDF fonts only cover Latin-1 style characters; replace anything else.
function safe(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/[^\x20-\x7e\xa0-\xff]/g, "");
}

/** A landscape A4 certificate. It records training only and says so. */
export async function buildCertificatePdf(data: CertificateData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${data.academyName} certificate ${data.number}`);
  const W = 842;
  const H = 595;
  const page = doc.addPage([W, H]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.09, 0.42, 0.29);
  const ink = rgb(0.09, 0.16, 0.14);
  const muted = rgb(0.39, 0.45, 0.43);

  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: green, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: green, borderWidth: 0.75 });

  // The holder's photo, framed in the top-right corner, clear of the centred title.
  if (data.photo && data.photo.length > 8) {
    const b = data.photo;
    const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
    const isJpeg = b[0] === 0xff && b[1] === 0xd8;
    if (isPng || isJpeg) {
      try {
        const image = isPng ? await doc.embedPng(b) : await doc.embedJpg(b);
        const size = 104;
        const x = W - 62 - size;
        const top = H - 58;
        // Fill the square frame, cropping the longer side evenly.
        const scale = Math.max(size / image.width, size / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        page.drawRectangle({ x: x - 4, y: top - size - 4, width: size + 8, height: size + 8, color: rgb(1, 1, 1), borderColor: green, borderWidth: 1.5 });
        // Clip to the frame so a photo that is not square cannot spill over the border.
        page.pushOperators(pushGraphicsState(), rectangle(x, top - size, size, size), clip(), endPath());
        page.drawImage(image, { x: x - (w - size) / 2, y: top - size - (h - size) / 2, width: w, height: h });
        page.pushOperators(popGraphicsState());
      } catch {
        // An unreadable photo leaves the certificate without one.
      }
    }
  }

  const centre = (text: string, y: number, size: number, font: PDFFont, color = ink) => {
    let t = safe(text);
    let s = size;
    // Long names shrink rather than run off the page.
    while (font.widthOfTextAtSize(t, s) > W - 140 && s > 10) s -= 1;
    if (font.widthOfTextAtSize(t, s) > W - 140) t = `${t.slice(0, 80)}...`;
    page.drawText(t, { x: (W - font.widthOfTextAtSize(t, s)) / 2, y, size: s, font, color });
  };

  centre(data.academyName.toUpperCase(), H - 92, 15, sansBold, green);
  centre("Certificate of Completion", H - 150, 40, serifBold);
  centre("This is to certify that", H - 196, 14, serif, muted);
  centre(data.holderName, H - 246, 34, serifBold, green);
  page.drawLine({ start: { x: 221, y: H - 258 }, end: { x: W - 221, y: H - 258 }, thickness: 0.75, color: muted });
  centre(`has completed all ${data.modules.length} modules of the ${data.academyName}`, H - 286, 14, serif);
  centre("and passed the assessment for each one:", H - 304, 14, serif);

  let y = H - 336;
  data.modules.forEach((m, i) => {
    centre(`${i + 1}. ${m.title}  -  ${m.scorePercent}%`, y, 12, sans);
    y -= 18;
  });

  const issued = new Date(data.issuedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const footY = 92;
  page.drawText(safe(`Awarded by ${data.companyName}`), { x: 70, y: footY, size: 12, font: sansBold, color: ink });
  page.drawText(safe(`Date: ${issued}`), { x: 70, y: footY - 18, size: 11, font: sans, color: ink });
  // Scan to see this certificate on the Solar Switch website.
  if (data.verifyUrl) {
    const qrSize = 74;
    const qrX = W - 70 - qrSize;
    drawQrCode(page, data.verifyUrl, qrX, footY + 22, qrSize, ink);
    const scan = "Scan to verify";
    page.drawText(scan, { x: qrX + (qrSize - sans.widthOfTextAtSize(scan, 8)) / 2, y: footY + 12, size: 8, font: sans, color: muted });
  }
  const num = `Certificate no. ${data.number}`;
  page.drawText(num, { x: W - 70 - sansBold.widthOfTextAtSize(num, 12), y: footY, size: 12, font: sansBold, color: ink });
  centre(
    "A record of sales training. It is not an electrical or installation qualification.",
    52, 9, sans, muted
  );
  return await doc.save();
}
