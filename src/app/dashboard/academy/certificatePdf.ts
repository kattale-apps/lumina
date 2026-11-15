import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";

export type CertificateData = {
  academyName: string;
  number: string;
  holderName: string;
  companyName: string;
  issuedAt: number;
  modules: { title: string; scorePercent: number }[];
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
  const num = `Certificate no. ${data.number}`;
  page.drawText(num, { x: W - 70 - sansBold.widthOfTextAtSize(num, 12), y: footY, size: 12, font: sansBold, color: ink });
  centre(
    "A record of sales training. It is not an electrical or installation qualification.",
    52, 9, sans, muted
  );
  return await doc.save();
}
