import { z } from "zod";
import { ConfidenceLevelSchema } from "../shared/confidence";
import { DomainError } from "../shared/errors";

export const EVIDENCE_TYPES = [
  "QUOTE",
  "REVIEW",
  "POST",
  "ARTICLE",
  "STATISTIC",
  "OFFICIAL_RECORD",
  "MANUAL_NOTE",
] as const;
export const EvidenceTypeSchema = z.enum(EVIDENCE_TYPES);
export type EvidenceType = z.infer<typeof EvidenceTypeSchema>;

export type Evidence = {
  id: string;
  researchRunId: string;
  sourceItemId: string;
  sourceUrl?: string;
  /** Verbatim excerpt of the source body. Never paraphrased. */
  evidenceText: string;
  /** Optional AI summary — an INFERENCE, displayed as such. */
  evidenceSummary?: string;
  evidenceType: EvidenceType;
  retrievedAt: string;
  confidence: z.infer<typeof ConfidenceLevelSchema>;
  language?: string;
  country?: string;
};

export type NewEvidence = Omit<Evidence, "id">;

/** Evidence text must appear verbatim in the source body. */
export function assertVerbatim(evidenceText: string, sourceBody: string): void {
  if (!evidenceText || !sourceBody.includes(evidenceText)) {
    throw new DomainError("EVIDENCE_INTEGRITY", "Evidence text is not a verbatim excerpt of its source", {
      evidenceText: evidenceText.slice(0, 120),
    });
  }
}

/**
 * Validate that every evidence id referenced by AI output exists in the set the
 * AI was given. Unknown ids are rejected — the model may not invent evidence.
 */
export function validateEvidenceRefs(
  referenced: readonly string[],
  known: ReadonlySet<string>,
): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of new Set(referenced)) (known.has(id) ? valid : invalid).push(id);
  return { valid, invalid };
}

export function requireEvidenceRefs(referenced: readonly string[], known: ReadonlySet<string>): string[] {
  const { valid, invalid } = validateEvidenceRefs(referenced, known);
  if (invalid.length > 0) {
    throw new DomainError("EVIDENCE_INTEGRITY", "Output references unknown evidence ids", { invalid });
  }
  if (valid.length === 0) {
    throw new DomainError("EVIDENCE_INTEGRITY", "Output must reference at least one evidence id");
  }
  return valid;
}

/**
 * Split a source body into candidate evidence excerpts (sentences), keeping
 * the exact substrings so they remain verbatim.
 */
export function splitIntoExcerpts(body: string, maxLength = 400): string[] {
  const parts = body
    .split(/(?<=[。！？!?\n])|(?<=\.)\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= maxLength) {
      out.push(p);
    } else {
      for (let i = 0; i < p.length; i += maxLength) out.push(p.slice(i, i + maxLength));
    }
  }
  return out.filter((s) => body.includes(s));
}
