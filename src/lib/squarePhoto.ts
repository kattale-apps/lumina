/**
 * Turns a phone photo into a square JPEG for a profile picture: crops the middle of the
 * picture (where a face usually is in a selfie) and scales it to 600 x 600, which stays sharp
 * on a certificate and is a small upload. JPEG also embeds directly in the certificate PDF.
 */
export async function squarePhoto(file: File, side = 600, quality = 0.86): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  const crop = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - crop) / 2;
  // Portrait selfies: keep a little more of the top, where the face is.
  const sy = bitmap.height > bitmap.width ? Math.max(0, (bitmap.height - crop) * 0.35) : (bitmap.height - crop) / 2;
  const size = Math.min(side, crop);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.drawImage(bitmap, sx, sy, crop, crop, 0, 0, size, size);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error("encode");
  return blob;
}
