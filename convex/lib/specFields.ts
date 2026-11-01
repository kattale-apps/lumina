import { ConvexError } from "convex/values";
import { requireText } from "./validation";

type FieldType = "number" | "text" | "boolean" | "choice";

export type SpecFieldInput = {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  options?: string[];
  required: boolean;
  critical: boolean;
};

const MAX_OPTIONS = 20;

export function validateCategoryKey(raw: string) {
  const key = raw.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(key)) {
    throw new ConvexError(
      "Category key must be 2–30 characters: lowercase letters, digits and underscores, starting with a letter."
    );
  }
  return key;
}

/** Turns a display name into a candidate category/field key. */
export function slugifyKey(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[0-9_]+/, "");
}

/** Validates and normalises a specification field definition. */
export function normaliseSpecField(input: SpecFieldInput) {
  const key = input.key.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
    throw new ConvexError(
      "Field key must be 1–40 characters: lowercase letters, digits and underscores, starting with a letter."
    );
  }
  const label = requireText(input.label, "Field label", 60);

  let unit: string | undefined;
  if (input.type === "number") {
    const trimmed = (input.unit ?? "").trim();
    if (trimmed.length > 12) throw new ConvexError("Unit must be 12 characters or fewer.");
    // An empty unit is allowed for pure counts (e.g. number of MPPT inputs).
    unit = trimmed;
  } else if (input.unit?.trim()) {
    throw new ConvexError("Only number fields have a unit.");
  }

  let options: string[] | undefined;
  if (input.type === "choice") {
    options = Array.from(new Set((input.options ?? []).map((o) => o.trim()).filter(Boolean)));
    if (options.length < 2) throw new ConvexError("A choice field needs at least two options.");
    if (options.length > MAX_OPTIONS) {
      throw new ConvexError(`A choice field can have at most ${MAX_OPTIONS} options.`);
    }
    if (options.some((o) => o.length > 40)) {
      throw new ConvexError("Each option must be 40 characters or fewer.");
    }
  } else if (input.options && input.options.length > 0) {
    throw new ConvexError("Only choice fields have options.");
  }

  return {
    key,
    label,
    type: input.type,
    ...(unit !== undefined ? { unit } : {}),
    ...(options ? { options } : {}),
    required: input.required,
    critical: input.critical,
    retired: false
  };
}
