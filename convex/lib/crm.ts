import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { AppRole } from "./auth";

/** Roles that may open the customer and assessment screens at all. */
export const CRM_READERS = ["super_admin", "sales_manager", "sales_agent", "technician"] as const;
/** Roles that may create and change customers and assessments. Technicians review only. */
export const CRM_WRITERS = ["super_admin", "sales_manager", "sales_agent"] as const;

/** Agents see only their own customers; managers, admins and technicians see all. */
export function seesAllCustomers(role: AppRole) {
  return role !== "sales_agent";
}

/** True when this user may view a record owned by `ownerUserId`. */
export function canAccessOwned(
  role: AppRole,
  profile: Doc<"userProfiles">,
  ownerUserId: Doc<"userProfiles">["_id"]
) {
  return seesAllCustomers(role) || ownerUserId === profile._id;
}

export function validatePhone(raw: string) {
  const phone = raw.trim();
  if (!/^\+?[0-9][0-9 ()-]{5,19}$/.test(phone)) {
    throw new ConvexError("Enter a valid phone number, e.g. +256 700 000000.");
  }
  return phone;
}

export function validateOptionalEmail(raw?: string) {
  const email = raw?.trim().toLowerCase();
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    throw new ConvexError("Enter a valid email address or leave it blank.");
  }
  return email;
}

export function optionalText(raw: string | undefined, label: string, maxLength: number) {
  const text = raw?.trim();
  if (!text) return undefined;
  if (text.length > maxLength) {
    throw new ConvexError(`${label} must be ${maxLength} characters or fewer.`);
  }
  return text;
}

export function validateGps(gps: { lat: number; lng: number } | undefined, consent: boolean) {
  if (!gps) return undefined;
  if (!consent) throw new ConvexError("GPS can be saved only with the customer's consent.");
  if (!(gps.lat >= -90 && gps.lat <= 90 && gps.lng >= -180 && gps.lng <= 180)) {
    throw new ConvexError("GPS coordinates are out of range.");
  }
  return gps;
}
