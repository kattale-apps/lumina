import type { Lang } from "../languages";
import type { ModuleContent } from "../academy";
import { ach } from "./ach";
import { lg } from "./lg";
import { nyn } from "./nyn";
import { sw } from "./sw";
import { teo } from "./teo";
import { xog } from "./xog";

/** A module's text in another language, matched to the English by lesson and question keys. */
export type ModuleTranslation = {
  key: string;
  title: string;
  summary: string;
  lessons: { key: string; title: string; body: string }[];
  questions: { key: string; prompt: string; options: string[]; explanation?: string }[];
};

/** Draft translations of the built-in course, shipped with the app. */
export const ACADEMY_DRAFTS: Partial<Record<Lang, ModuleTranslation[]>> = { lg, nyn, sw, ach, xog, teo };

/**
 * The module as a learner reads it in `lang`: translated text where a translation covers it,
 * English for anything missing. A question's options are only swapped when the translation has
 * the same number of them, so the answer positions the quiz is marked on never move.
 */
export function translateModule<M extends ModuleContent>(module: M, translation: ModuleTranslation | null) {
  if (!translation) return { ...module, translated: false };
  const lessons = new Map(translation.lessons.map((l) => [l.key, l]));
  const questions = new Map(translation.questions.map((q) => [q.key, q]));
  return {
    ...module,
    title: translation.title.trim() || module.title,
    summary: translation.summary.trim() || module.summary,
    lessons: module.lessons.map((l) => {
      const t = lessons.get(l.key);
      return t ? { ...l, title: t.title.trim() || l.title, body: t.body.trim() || l.body } : l;
    }),
    questions: module.questions.map((q) => {
      const t = questions.get(q.key);
      if (!t) return q;
      const sameShape = t.options.length === q.options.length && t.options.every((o) => o.trim());
      return {
        ...q,
        prompt: t.prompt.trim() || q.prompt,
        options: sameShape ? t.options.map((o) => o.trim()) : q.options,
        explanation: t.explanation?.trim() || q.explanation
      };
    }),
    translated: true
  };
}
