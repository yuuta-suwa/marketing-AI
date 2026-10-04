import type { ComplianceProfile } from "@/domain/compliance/compliance";

export type SearchQuery = {
  query: string;
  count: number;
  language?: string;
  country?: string;
  signal?: AbortSignal;
};

export type SearchResult = {
  url: string;
  title?: string;
  snippets: string[];
  publishedAt?: string;
  language?: string;
};

/**
 * Pluggable web search backend. WebSearchConnector depends only on this
 * port, so switching providers never touches business logic.
 */
export interface SearchProvider {
  readonly id: string;
  readonly name: string;
  readonly costPerQueryUsd: number;
  readonly env: ReadonlyArray<{ name: string; description: string; secret: boolean }>;
  configured(): boolean;
  compliance(): ComplianceProfile;
  search(q: SearchQuery): Promise<SearchResult[]>;
  /** Minimal live request (1 result) for readiness checks. */
  ping?(signal?: AbortSignal): Promise<{ detail: string }>;
}
