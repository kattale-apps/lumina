/**
 * Sales Academy rules that do not touch the database: what a valid module
 * looks like, and how a quiz is marked. Pure functions, so they are tested
 * directly.
 */
export type Lesson = { key: string; title: string; body: string; videoUrl?: string };
export type Question = { key: string; prompt: string; options: string[]; correctIndex: number; explanation?: string };
export type ModuleContent = {
  key: string;
  title: string;
  summary: string;
  lessons: Lesson[];
  questions: Question[];
  /** Share of questions that must be right to pass, 50 to 100. */
  passPercent: number;
};

/** The course always has these four modules, in this order. */
export const MODULE_KEYS = ["m1", "m2", "m3", "m4"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(key: string): key is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(key);
}

export const LIMITS = {
  title: 120,
  summary: 400,
  lessons: 12,
  lessonBody: 8000,
  videoUrl: 300,
  minQuestions: 3,
  maxQuestions: 30,
  prompt: 400,
  minOptions: 2,
  maxOptions: 6,
  option: 200,
  explanation: 500
};

/** A video must be an ordinary https link; anything else is refused rather than shown to staff. */
export function isAcceptableVideoUrl(raw: string) {
  if (raw.length > LIMITS.videoUrl) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname.includes(".") && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Trims every text field and drops empty optional ones. */
export function tidyModule(m: ModuleContent): ModuleContent {
  return {
    key: m.key,
    title: m.title.trim(),
    summary: m.summary.trim(),
    passPercent: m.passPercent,
    lessons: m.lessons.map((l) => {
      const video = l.videoUrl?.trim();
      return { key: l.key, title: l.title.trim(), body: l.body.trim(), ...(video ? { videoUrl: video } : {}) };
    }),
    questions: m.questions.map((q) => {
      const explanation = q.explanation?.trim();
      return {
        key: q.key,
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()),
        correctIndex: q.correctIndex,
        ...(explanation ? { explanation } : {})
      };
    })
  };
}

/** Returns the first problem with a (tidied) module, or null when it can be saved. */
export function validateModule(m: ModuleContent): string | null {
  if (!m.title) return "Give the module a title.";
  if (m.title.length > LIMITS.title) return `The module title must be ${LIMITS.title} characters or fewer.`;
  if (!m.summary) return "Give the module a short summary.";
  if (m.summary.length > LIMITS.summary) return `The summary must be ${LIMITS.summary} characters or fewer.`;
  if (!Number.isInteger(m.passPercent) || m.passPercent < 50 || m.passPercent > 100) {
    return "The pass mark must be a whole number from 50 to 100.";
  }

  if (m.lessons.length === 0) return "Add at least one lesson.";
  if (m.lessons.length > LIMITS.lessons) return `A module can have at most ${LIMITS.lessons} lessons.`;
  const keys = new Set<string>();
  for (const [i, l] of m.lessons.entries()) {
    const label = `Lesson ${i + 1}`;
    if (!l.key || keys.has(l.key)) return `${label} has a missing or repeated identifier.`;
    keys.add(l.key);
    if (!l.title) return `${label} needs a title.`;
    if (l.title.length > LIMITS.title) return `${label}: the title must be ${LIMITS.title} characters or fewer.`;
    if (!l.body) return `${label} needs some text.`;
    if (l.body.length > LIMITS.lessonBody) return `${label}: the text must be ${LIMITS.lessonBody} characters or fewer.`;
    if (l.videoUrl !== undefined && !isAcceptableVideoUrl(l.videoUrl)) {
      return `${label}: the video link must be a full https:// address.`;
    }
  }

  if (m.questions.length < LIMITS.minQuestions) return `Add at least ${LIMITS.minQuestions} quiz questions.`;
  if (m.questions.length > LIMITS.maxQuestions) return `A quiz can have at most ${LIMITS.maxQuestions} questions.`;
  for (const [i, q] of m.questions.entries()) {
    const label = `Question ${i + 1}`;
    if (!q.key || keys.has(q.key)) return `${label} has a missing or repeated identifier.`;
    keys.add(q.key);
    if (!q.prompt) return `${label} needs its question text.`;
    if (q.prompt.length > LIMITS.prompt) return `${label}: the question must be ${LIMITS.prompt} characters or fewer.`;
    if (q.options.length < LIMITS.minOptions) return `${label} needs at least ${LIMITS.minOptions} answers.`;
    if (q.options.length > LIMITS.maxOptions) return `${label} can have at most ${LIMITS.maxOptions} answers.`;
    if (q.options.some((o) => !o)) return `${label} has an empty answer.`;
    if (q.options.some((o) => o.length > LIMITS.option)) return `${label}: each answer must be ${LIMITS.option} characters or fewer.`;
    if (new Set(q.options.map((o) => o.toLowerCase())).size !== q.options.length) return `${label} has the same answer twice.`;
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) {
      return `${label}: mark which answer is correct.`;
    }
    if (q.explanation !== undefined && q.explanation.length > LIMITS.explanation) {
      return `${label}: the explanation must be ${LIMITS.explanation} characters or fewer.`;
    }
  }
  return null;
}

export type Marked = {
  correct: number;
  total: number;
  /** Rounded for display. Passing is decided on the exact share, not this figure. */
  scorePercent: number;
  passed: boolean;
  /** One entry per question, in question order. */
  results: boolean[];
};

/**
 * Marks a quiz. `answers` holds the chosen option index for each question, in
 * question order; a missing or out-of-range answer is simply wrong.
 */
export function markQuiz(questions: Question[], answers: number[], passPercent: number): Marked {
  const results = questions.map((q, i) => answers[i] === q.correctIndex);
  const correct = results.filter(Boolean).length;
  const total = questions.length;
  return {
    correct,
    total,
    scorePercent: total === 0 ? 0 : Math.round((correct / total) * 100),
    passed: total > 0 && correct * 100 >= passPercent * total,
    results
  };
}

export function certificateNumber(year: number, sequence: number) {
  return `SSA-${year}-${String(sequence).padStart(5, "0")}`;
}
