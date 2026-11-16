import { describe, expect, test } from "vitest";
import { DEFAULT_MODULES } from "../../../convex/lib/academyContent";
import { ACADEMY_DRAFTS } from "../../../convex/lib/academyI18n";
import { TRANSLATED_LANGS } from "../../../convex/lib/languages";
import { BUNDLES } from "./bundles";
import { en, type MessageKey } from "./en";

/** {placeholders}, **bold** and [link] markers, which every translation must keep. */
function markers(text: string) {
  const placeholders = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const bold = (text.match(/\*\*/g) ?? []).length;
  const links = (text.match(/\[[^\]]+\]/g) ?? []).length;
  return { placeholders, bold, links };
}

describe("screen text translations", () => {
  for (const lang of TRANSLATED_LANGS) {
    test(`${lang}: only known keys, with the same placeholders, bold and links as English`, () => {
      const bundle = BUNDLES[lang] ?? {};
      const problems: string[] = [];
      for (const [key, text] of Object.entries(bundle)) {
        if (!(key in en)) {
          problems.push(`unknown key ${key}`);
          continue;
        }
        if (typeof text !== "string" || !text.trim()) {
          problems.push(`${key}: empty`);
          continue;
        }
        const want = markers(en[key as MessageKey]);
        const got = markers(text);
        if (want.placeholders.join() !== got.placeholders.join()) problems.push(`${key}: placeholders ${got.placeholders} should be ${want.placeholders}`);
        if (want.bold !== got.bold) problems.push(`${key}: ${got.bold / 2} bold parts, English has ${want.bold / 2}`);
        if (want.links !== got.links) problems.push(`${key}: ${got.links} links, English has ${want.links}`);
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("Sales Academy translations", () => {
  for (const lang of TRANSLATED_LANGS) {
    test(`${lang}: modules line up with the English course`, () => {
      const problems: string[] = [];
      for (const t of ACADEMY_DRAFTS[lang] ?? []) {
        const source = DEFAULT_MODULES.find((m) => m.key === t.key);
        if (!source) {
          problems.push(`unknown module ${t.key}`);
          continue;
        }
        if (!t.title.trim() || !t.summary.trim()) problems.push(`${t.key}: missing title or summary`);
        for (const l of t.lessons) {
          if (!source.lessons.some((s) => s.key === l.key)) problems.push(`${t.key}: unknown lesson ${l.key}`);
          if (!l.title.trim() || !l.body.trim()) problems.push(`${l.key}: empty title or body`);
        }
        for (const q of t.questions) {
          const sq = source.questions.find((s) => s.key === q.key);
          if (!sq) {
            problems.push(`${t.key}: unknown question ${q.key}`);
            continue;
          }
          if (q.options.length !== sq.options.length) problems.push(`${q.key}: ${q.options.length} options, English has ${sq.options.length}`);
          if (!q.prompt.trim() || q.options.some((o) => !o.trim())) problems.push(`${q.key}: empty prompt or option`);
        }
      }
      expect(problems).toEqual([]);
    });
  }
});
