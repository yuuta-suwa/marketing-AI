import { z } from "zod";

export const SOURCE_PREFERENCE_KEYS = [
  "manual_import",
  "web_search",
  "estat",
  "x",
  "google_places",
  "tripadvisor",
] as const;

export const TimeRangeSchema = z
  .object({
    preset: z.enum(["7d", "30d", "90d", "1y", "all"]).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((r) => !(r.from && r.to) || r.from <= r.to, { message: "time_range.from must be <= to" });
export type TimeRange = z.infer<typeof TimeRangeSchema>;

const shortText = z.string().trim().min(1).max(120);

/** Structured, validated research instruction. AI parsers must produce this shape. */
export const ResearchDirectiveSchema = z.object({
  rawInput: z.string().trim().min(1).max(4000),
  objective: z.string().trim().min(1).max(500),
  countries: z.array(z.string().regex(/^[A-Z]{2}$|^GLOBAL$/)).max(30).default([]),
  languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(20).default([]),
  personas: z.array(shortText).max(20).default([]),
  categories: z.array(shortText).max(20).default([]),
  keywords: z.array(shortText).max(40).default([]),
  negativeKeywords: z.array(shortText).max(40).default([]),
  timeRange: TimeRangeSchema.default({ preset: "90d" }),
  sourcePreferences: z.array(z.string().regex(/^[a-z0-9_]{2,64}$/)).max(30).default([]),
  maxItems: z.number().int().min(1).max(500).default(50),
  budgetLimitUsd: z.number().min(0).max(1000).default(0.5),
  deepResearch: z.boolean().default(false),
});
export type ResearchDirective = z.infer<typeof ResearchDirectiveSchema>;

export type StoredResearchDirective = ResearchDirective & {
  id: string;
  organizationId: string;
  parser: "rule" | "ai";
  createdBy: string;
  createdAt: string;
};

/** User-facing form input (mobile). Only free text is required. */
export const ResearchRequestSchema = z.object({
  input: z.string().trim().min(4, "調査内容を入力してください").max(4000),
  deepResearch: z.boolean().optional(),
  maxItems: z.number().int().min(1).max(500).optional(),
  budgetLimitUsd: z.number().min(0).max(1000).optional(),
  sourcePreferences: z.array(z.string().regex(/^[a-z0-9_]{2,64}$/)).max(30).optional(),
  /** Advanced overrides — when present they win over parsed values. */
  countries: z.array(z.string().regex(/^[A-Z]{2}$|^GLOBAL$/)).max(30).optional(),
  languages: z.array(z.string().regex(/^[a-z]{2}$/)).max(20).optional(),
  timeRangePreset: z.enum(["7d", "30d", "90d", "1y", "all"]).optional(),
  /** Pages the user asks to import (fetched server-side, robots.txt respected). */
  manualUrls: z.array(z.url({ protocol: /^https?$/ })).max(20).optional(),
  manualItems: z
    .array(
      z.object({
        title: z.string().max(300).optional(),
        body: z.string().trim().min(1).max(20000),
        url: z.url().optional(),
        sourceName: z.string().max(120).optional(),
        language: z.string().max(10).optional(),
        country: z.string().max(10).optional(),
        publishedAt: z.iso.datetime({ offset: true }).optional(),
      }),
    )
    .max(200)
    .optional(),
});
export type ResearchRequest = z.infer<typeof ResearchRequestSchema>;
