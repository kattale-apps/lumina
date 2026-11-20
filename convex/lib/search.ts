/**
 * Word-by-word search used by the catalogue search boxes. Every typed word must start a word in
 * the text, ignoring case and simple plurals, so "solar" finds "Solar panels", "panel" finds
 * "Solar panels" and "batteries" finds "Lithium battery".
 */
function stem(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("es") && /(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);

/** Typed words, ready to match many texts. */
export function searchWords(term: string) {
  return wordsOf(term).map((w) => ({ raw: w, stem: stem(w) })).slice(0, 8);
}

/** True when every typed word starts some word of the text (or the text contains it, for model codes). */
export function matchesWords(text: string, words: ReturnType<typeof searchWords>) {
  if (words.length === 0) return true;
  const lower = text.toLowerCase();
  const textWords = wordsOf(text);
  const textStems = textWords.map(stem);
  return words.every(
    (w) =>
      textWords.some((t) => t.startsWith(w.raw)) ||
      textStems.some((t) => t.startsWith(w.stem)) ||
      (w.raw.length >= 3 && /\d/.test(w.raw) && lower.includes(w.raw))
  );
}

export type Suggestion = {
  /** What the suggestion is: a group of products, a brand, a supplier, or one product name. */
  kind: "category" | "brand" | "supplier" | "product";
  /** The value it applies (a category id, a brand, a product name). */
  value: string;
  label: string;
  /** How many products it covers. */
  count: number;
};

const KIND_ORDER: Record<Suggestion["kind"], number> = { category: 0, brand: 1, supplier: 2, product: 3 };

/**
 * The suggestions to show under a search box: categories first, then brands, then product names,
 * with labels that start with what was typed ahead of the rest.
 */
export function suggestionsFor(term: string, all: Suggestion[], limit = 8) {
  const words = searchWords(term);
  if (words.length === 0) return [];
  const first = words[0].raw;
  return all
    .filter((s) => matchesWords(s.label, words))
    .sort(
      (a, b) =>
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        Number(!a.label.toLowerCase().startsWith(first)) - Number(!b.label.toLowerCase().startsWith(first)) ||
        b.count - a.count ||
        a.label.localeCompare(b.label)
    )
    .slice(0, limit);
}

/** Counts values into suggestions of one kind, e.g. product names with how many brands sell each. */
export function countInto(kind: Suggestion["kind"], values: { value: string; label?: string }[]): Suggestion[] {
  const map = new Map<string, Suggestion>();
  for (const v of values) {
    if (!v.value) continue;
    const key = v.value.toLowerCase();
    const s = map.get(key);
    if (s) s.count++;
    else map.set(key, { kind, value: v.value, label: v.label ?? v.value, count: 1 });
  }
  return [...map.values()];
}
