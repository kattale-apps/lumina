import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";

export type SpecValues = Record<string, number | string | boolean>;

const MAX_TEXT = 200;

/**
 * Checks values against a category's specification fields and returns the
 * cleaned set. Missing required fields and wrong types are rejected; a missing
 * *critical* field is allowed but reported by {@link missingCritical}, so the
 * product shows as "cannot validate" rather than silently passing checks.
 */
export function validateSpecValues(
  category: Doc<"productCategories">,
  input: SpecValues
) {
  const fields = new Map(category.specFields.map((f) => [f.key, f]));
  const cleaned: SpecValues = {};

  for (const key of Object.keys(input)) {
    if (!fields.has(key)) throw new ConvexError(`"${key}" is not a specification of ${category.name}.`);
  }

  for (const field of category.specFields) {
    const value = input[field.key];
    if (value === undefined || (typeof value === "string" && value.trim() === "")) {
      if (field.required && !field.retired) {
        throw new ConvexError(`${field.label} is required.`);
      }
      continue;
    }

    switch (field.type) {
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new ConvexError(`${field.label} must be a number${field.unit ? ` in ${field.unit}` : ""}.`);
        }
        cleaned[field.key] = value;
        break;
      case "boolean":
        if (typeof value !== "boolean") throw new ConvexError(`${field.label} must be yes or no.`);
        cleaned[field.key] = value;
        break;
      case "text": {
        if (typeof value !== "string") throw new ConvexError(`${field.label} must be text.`);
        const text = value.trim();
        if (text.length > MAX_TEXT) throw new ConvexError(`${field.label} must be ${MAX_TEXT} characters or fewer.`);
        cleaned[field.key] = text;
        break;
      }
      case "choice":
        if (typeof value !== "string" || !(field.options ?? []).includes(value)) {
          throw new ConvexError(`${field.label} must be one of: ${(field.options ?? []).join(", ")}.`);
        }
        cleaned[field.key] = value;
        break;
    }
  }
  return cleaned;
}

/** Labels of critical specifications this product has no value for. */
export function missingCritical(category: Doc<"productCategories">, values: SpecValues) {
  return category.specFields
    .filter((f) => f.critical && !f.retired && values[f.key] === undefined)
    .map((f) => f.label);
}
