import { ConnectorError } from "@/domain/connector/connector";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type EnvReader = (name: string) => string | undefined;
export const processEnv: EnvReader = (name) => {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : undefined;
};

/**
 * JSON GET/POST with timeout. 429 / 5xx are marked retryable; the pipeline
 * decides whether to retry (bounded). Never bypasses rate limits.
 */
export async function fetchJson<T>(
  connectorId: string,
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? 15_000);
  const onAbort = () => controller.abort();
  init.signal?.addEventListener("abort", onAbort);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new ConnectorError(connectorId, `HTTP ${res.status} from ${new URL(url).host}`, retryable, res.status);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      // A 200 with HTML/garbage is a provider-side problem; retrying will not fix it.
      throw new ConnectorError(connectorId, `invalid response: expected JSON from ${new URL(url).host}`, false, res.status);
    }
  } catch (e) {
    if (e instanceof ConnectorError) throw e;
    const aborted = e instanceof Error && e.name === "AbortError";
    throw new ConnectorError(connectorId, aborted ? "request timed out" : `network error: ${(e as Error).message}`, true);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

/** Search query from a directive: keywords first, then objective. */
export function buildQuery(keywords: readonly string[], objective: string, maxTerms = 6): string {
  const terms = keywords.slice(0, maxTerms);
  return (terms.length > 0 ? terms.join(" ") : objective).slice(0, 400);
}

export function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}
