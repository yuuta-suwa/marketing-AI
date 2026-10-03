import { z } from "zod";

/** What a connector returns before normalization (no ids, no hash). */
export const RawSourceItemSchema = z.object({
  sourceType: z.string().min(1).max(64),
  sourceName: z.string().min(1).max(200),
  sourceUrl: z.url().optional(),
  externalId: z.string().min(1).max(512).optional(),
  title: z.string().max(1000).optional(),
  body: z.string().min(1).max(100_000),
  language: z.string().max(10).optional(),
  country: z.string().max(10).optional(),
  publishedAt: z.iso.datetime({ offset: true }).optional(),
  engagement: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type RawSourceItem = z.infer<typeof RawSourceItemSchema>;

export const SOURCE_COMPLIANCE_STATUSES = ["APPROVED", "MANUAL_UPLOAD"] as const;
export type SourceComplianceStatus = (typeof SOURCE_COMPLIANCE_STATUSES)[number];

/** Normalized, connector-agnostic item stored in the evidence lake. */
export type SourceItem = {
  id: string;
  researchRunId: string;
  connectorId: string;
  sourceType: string;
  sourceName: string;
  sourceUrl?: string;
  canonicalUrl?: string;
  externalId?: string;
  title?: string;
  body: string;
  language?: string;
  country?: string;
  publishedAt?: string;
  retrievedAt: string;
  engagement?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  contentHash: string;
  complianceStatus: SourceComplianceStatus;
};

export type NewSourceItem = Omit<SourceItem, "id">;
