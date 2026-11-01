import { ConvexError } from "convex/values";

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function validateCurrency(raw: string) {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new ConvexError(`"${raw}" is not a three-letter ISO 4217 currency code.`);
  }
  return code;
}

export function requireText(raw: string, label: string, maxLength: number) {
  const text = raw.trim();
  if (!text) throw new ConvexError(`${label} is required.`);
  if (text.length > maxLength) {
    throw new ConvexError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

export function validateWarehouseCode(raw: string) {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(code) || code.length > 20) {
    throw new ConvexError(
      "Warehouse code must be 1–20 letters or digits, with single hyphens between parts, e.g. \"KLA-MAIN\"."
    );
  }
  return code;
}
