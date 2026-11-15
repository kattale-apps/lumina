import { describe, expect, test } from "vitest";
import {
  certificateNumber,
  isAcceptableVideoUrl,
  markQuiz,
  MODULE_KEYS,
  tidyModule,
  validateModule,
  type ModuleContent,
  type Question
} from "./lib/academy";
import { DEFAULT_MODULES } from "./lib/academyContent";

const q = (key: string, correctIndex: number): Question => ({
  key, prompt: `Question ${key}`, options: ["A", "B", "C", "D"], correctIndex
});
const six = [q("1", 0), q("2", 1), q("3", 2), q("4", 3), q("5", 0), q("6", 1)];

describe("marking a quiz", () => {
  test("every answer right is 100% and a pass", () => {
    expect(markQuiz(six, [0, 1, 2, 3, 0, 1], 80)).toEqual({
      correct: 6, total: 6, scorePercent: 100, passed: true, results: [true, true, true, true, true, true]
    });
  });

  test("five of six passes an 80% mark; four of six does not", () => {
    // 5/6 = 83.3%, 4/6 = 66.7%.
    expect(markQuiz(six, [0, 1, 2, 3, 0, 0], 80).passed).toBe(true);
    expect(markQuiz(six, [0, 1, 2, 3, 1, 0], 80).passed).toBe(false);
    expect(markQuiz(six, [0, 1, 2, 3, 1, 0], 80).scorePercent).toBe(67);
  });

  test("passing is decided on the exact share, not the rounded score", () => {
    // 2 of 3 is 66.67%, shown as 67 but below a 67% pass mark.
    const three = [q("1", 0), q("2", 0), q("3", 0)];
    const marked = markQuiz(three, [0, 0, 1], 67);
    expect(marked.scorePercent).toBe(67);
    expect(marked.passed).toBe(false);
  });

  test("missing and out-of-range answers are wrong", () => {
    const marked = markQuiz(six, [0, 1, -1, 9], 80);
    expect(marked.correct).toBe(2);
    expect(marked.results).toEqual([true, true, false, false, false, false]);
  });

  test("an empty quiz cannot be passed", () => {
    expect(markQuiz([], [], 50).passed).toBe(false);
  });
});

describe("module rules", () => {
  const good: ModuleContent = {
    key: "m1", title: "Title", summary: "Summary", passPercent: 80,
    lessons: [{ key: "l1", title: "Lesson", body: "Text" }],
    questions: [q("q1", 0), q("q2", 1), q("q3", 2)]
  };

  test("a sound module is accepted", () => {
    expect(validateModule(good)).toBeNull();
  });

  test("tidying trims text and drops empty optional fields", () => {
    const tidy = tidyModule({
      ...good,
      title: "  Title ",
      lessons: [{ key: "l1", title: " Lesson ", body: " Text\n", videoUrl: "   " }],
      questions: [{ ...q("q1", 0), explanation: " " }, q("q2", 1), q("q3", 2)]
    });
    expect(tidy.title).toBe("Title");
    expect(tidy.lessons[0]).toEqual({ key: "l1", title: "Lesson", body: "Text" });
    expect(tidy.questions[0].explanation).toBeUndefined();
  });

  test("problems are reported in plain words", () => {
    expect(validateModule({ ...good, title: "" })).toBe("Give the module a title.");
    expect(validateModule({ ...good, passPercent: 40 })).toMatch(/pass mark/);
    expect(validateModule({ ...good, lessons: [] })).toBe("Add at least one lesson.");
    expect(validateModule({ ...good, questions: [q("q1", 0)] })).toMatch(/at least 3 quiz questions/);
    expect(validateModule({ ...good, questions: [q("q1", 4), q("q2", 1), q("q3", 2)] })).toMatch(/Question 1: mark which answer is correct/);
    expect(validateModule({ ...good, questions: [{ ...q("q1", 0), options: ["Yes", "yes"] }, q("q2", 1), q("q3", 2)] })).toMatch(/same answer twice/);
    expect(validateModule({ ...good, questions: [q("q1", 0), q("q1", 1), q("q3", 2)] })).toMatch(/repeated identifier/);
    expect(validateModule({ ...good, lessons: [{ key: "l1", title: "L", body: "T", videoUrl: "http://example.com/v" }] })).toMatch(/https/);
  });

  test("only ordinary https links are accepted as videos", () => {
    expect(isAcceptableVideoUrl("https://www.youtube.com/watch?v=abc123")).toBe(true);
    expect(isAcceptableVideoUrl("http://www.youtube.com/watch?v=abc123")).toBe(false);
    expect(isAcceptableVideoUrl("javascript:alert(1)")).toBe(false);
    expect(isAcceptableVideoUrl("https://user:pw@example.com/")).toBe(false);
    expect(isAcceptableVideoUrl("not a link")).toBe(false);
  });

  test("certificate numbers are padded and carry the year", () => {
    expect(certificateNumber(2026, 7)).toBe("SSA-2026-00007");
  });
});

describe("the built-in course", () => {
  test("has the four modules in order, each valid as written", () => {
    expect(DEFAULT_MODULES.map((m) => m.key)).toEqual([...MODULE_KEYS]);
    for (const m of DEFAULT_MODULES) {
      expect(validateModule(m)).toBeNull();
      // Saving it unchanged must not alter it.
      expect(tidyModule(m)).toEqual(m);
      expect(m.lessons.length).toBe(4);
      expect(m.questions.length).toBe(6);
    }
  });

  test("identifiers are unique across the whole course", () => {
    const keys = DEFAULT_MODULES.flatMap((m) => [...m.lessons.map((l) => l.key), ...m.questions.map((x) => x.key)]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("a quiz cannot be passed by always choosing the same position", () => {
    for (const m of DEFAULT_MODULES) {
      for (let position = 0; position < 4; position++) {
        expect(markQuiz(m.questions, m.questions.map(() => position), m.passPercent).passed).toBe(false);
      }
    }
  });
});
