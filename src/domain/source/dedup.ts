import type { NewSourceItem } from "./source-item";

export type DuplicateReason = "external_id" | "canonical_url" | "content_hash" | "semantic";

export type DedupResult<T> = {
  unique: T[];
  duplicates: Array<{ item: T; duplicateOf: T; reason: DuplicateReason }>;
};

type DedupKeyed = Pick<NewSourceItem, "connectorId" | "externalId" | "canonicalUrl" | "contentHash">;

/**
 * Deterministic de-duplication. Precedence:
 *   1. same connector + external_id
 *   2. same content_hash (normalized title+body)
 *   3. same canonical_url — ONLY for items without an external id. Many
 *      sources (reviews, posts) share a page URL while being distinct items.
 *   4. optional semantic similarity (supplied comparator, e.g. embeddings)
 * `existing` lets callers dedup against items already stored for the run.
 */
export function deduplicate<T extends DedupKeyed>(
  items: readonly T[],
  options: {
    existing?: readonly T[];
    isSemanticDuplicate?: (a: T, b: T) => boolean;
  } = {},
): DedupResult<T> {
  const byExternal = new Map<string, T>();
  const byHash = new Map<string, T>();
  const byUrl = new Map<string, T>();
  const kept: T[] = [];
  const duplicates: DedupResult<T>["duplicates"] = [];

  const index = (item: T) => {
    if (item.externalId) byExternal.set(`${item.connectorId}::${item.externalId}`, item);
    byHash.set(item.contentHash, item);
    if (item.canonicalUrl && !item.externalId) byUrl.set(item.canonicalUrl, item);
  };
  const pool: T[] = [];
  for (const e of options.existing ?? []) {
    index(e);
    pool.push(e);
  }

  for (const item of items) {
    let match: T | undefined;
    let reason: DuplicateReason | undefined;
    if (item.externalId) {
      match = byExternal.get(`${item.connectorId}::${item.externalId}`);
      reason = "external_id";
    }
    if (!match) {
      match = byHash.get(item.contentHash);
      reason = "content_hash";
    }
    if (!match && item.canonicalUrl && !item.externalId) {
      match = byUrl.get(item.canonicalUrl);
      reason = "canonical_url";
    }
    if (!match && options.isSemanticDuplicate) {
      match = pool.find((p) => options.isSemanticDuplicate!(p, item));
      reason = "semantic";
    }
    if (match && reason) {
      duplicates.push({ item, duplicateOf: match, reason });
      continue;
    }
    index(item);
    pool.push(item);
    kept.push(item);
  }
  return { unique: kept, duplicates };
}
