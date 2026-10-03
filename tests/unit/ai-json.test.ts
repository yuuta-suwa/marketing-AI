import { describe, expect, it } from "vitest";
import { extractJson } from "@/infrastructure/ai/json";

describe("LLM JSON extraction", () => {
  it("handles plain JSON, fenced JSON and leading prose", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"signals":[]}\n```')).toEqual({ signals: [] });
    expect(extractJson('Here you go: {"x":[1,2]} thanks')).toEqual({ x: [1, 2] });
  });

  it("throws when there is no JSON", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});
