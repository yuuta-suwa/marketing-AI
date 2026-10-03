/** Extracts the first JSON value from model text (tolerates code fences). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error("model returned no JSON");
  return JSON.parse(candidate.slice(start, Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]")) + 1));
}

