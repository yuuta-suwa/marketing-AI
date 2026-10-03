import type { MarketConnector } from "@/domain/connector/connector";
import { EStatConnector } from "./estat";
import { GooglePlacesConnector } from "./google-places";
import { processEnv, type EnvReader, type FetchLike } from "./http";
import { ManualImportConnector } from "./manual-import";
import { createMockFetch, markSynthetic, mockEnv } from "./mock";
import { FUTURE_CONNECTORS, ScaffoldConnector } from "./scaffold";
import { TripadvisorConnector } from "./tripadvisor";
import { BraveSearchProvider } from "./search/brave";
import { WebSearchConnector } from "./web-search";
import { XConnector } from "./x";

export interface ConnectorRegistry {
  list(): MarketConnector[];
  get(id: string): MarketConnector | undefined;
}

export class StaticConnectorRegistry implements ConnectorRegistry {
  private readonly byId: Map<string, MarketConnector>;

  constructor(connectors: MarketConnector[]) {
    this.byId = new Map(connectors.map((c) => [c.id, c]));
  }

  list(): MarketConnector[] {
    return [...this.byId.values()];
  }

  get(id: string): MarketConnector | undefined {
    return this.byId.get(id);
  }
}

export function createDefaultConnectorRegistry(
  deps: { fetch?: FetchLike; env?: EnvReader; mock?: { fail?: string[] } } = {},
): ConnectorRegistry {
  const f = deps.mock ? createMockFetch(deps.mock) : (deps.fetch ?? ((input, init) => fetch(input, init)));
  const env = deps.mock ? mockEnv(deps.env ?? processEnv) : (deps.env ?? processEnv);
  const connectors: MarketConnector[] = [
    new ManualImportConnector(),
    new WebSearchConnector(new BraveSearchProvider(f, env)),
    new EStatConnector(f, env),
    new XConnector(f, env),
    new GooglePlacesConnector(f, env),
    new TripadvisorConnector(f, env),
    ...FUTURE_CONNECTORS.map((spec) => new ScaffoldConnector(spec)),
  ];
  return new StaticConnectorRegistry(deps.mock ? connectors.map(markSynthetic) : connectors);
}
