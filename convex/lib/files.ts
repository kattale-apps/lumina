import { ConvexError } from "convex/values";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_DATASHEET_BYTES = 15 * 1024 * 1024;
export const MAX_IMAGES_PER_PRODUCT = 8;
export const MAX_DATASHEETS_PER_PRODUCT = 5;

export type FileKind = "image" | "datasheet";

/**
 * Identifies a file from its leading bytes rather than trusting the type the
 * browser reported. Only PNG, JPEG and WebP images and PDF datasheets pass.
 */
export function sniffFile(head: Uint8Array): { kind: FileKind; contentType: string } | null {
  const startsWith = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);

  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { kind: "image", contentType: "image/png" };
  }
  if (startsWith(0xff, 0xd8, 0xff)) return { kind: "image", contentType: "image/jpeg" };
  // "RIFF" ???? "WEBP"
  if (
    startsWith(0x52, 0x49, 0x46, 0x46) &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return { kind: "image", contentType: "image/webp" };
  }
  if (startsWith(0x25, 0x50, 0x44, 0x46, 0x2d)) {
    return { kind: "datasheet", contentType: "application/pdf" };
  }
  return null;
}

export function maxBytesFor(kind: FileKind) {
  return kind === "image" ? MAX_IMAGE_BYTES : MAX_DATASHEET_BYTES;
}

/** Drops any path, control characters and odd whitespace from an uploaded file name. */
export function cleanFileName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  const name = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (!name) throw new ConvexError("The file needs a name.");
  return name.length > 120 ? name.slice(-120) : name;
}
