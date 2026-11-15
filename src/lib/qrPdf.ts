import QRCode from "qrcode";
import { rgb, type PDFPage, type RGB } from "pdf-lib";

/**
 * Draws a QR code for `text` as vector squares, so it stays sharp when printed.
 * (x, y) is the bottom-left corner; `size` includes the white quiet zone around the code.
 */
export function drawQrCode(page: PDFPage, text: string, x: number, y: number, size: number, color: RGB = rgb(0, 0, 0)) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 2; // modules of white margin on each side
  const cell = size / (n + quiet * 2);
  page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
  for (let row = 0; row < n; row++) {
    // Join neighbouring dark modules in a row into one rectangle.
    let col = 0;
    while (col < n) {
      if (!qr.modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && qr.modules.get(row, col)) col++;
      page.drawRectangle({
        x: x + (quiet + start) * cell,
        y: y + size - (quiet + row + 1) * cell,
        width: (col - start) * cell + 0.05,
        height: cell + 0.05,
        color
      });
    }
  }
}
