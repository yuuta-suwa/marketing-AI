export const BUSINESS_MODEL_TYPES = [
  "SUBSCRIPTION",
  "TRANSACTION_FEE",
  "MARKETPLACE_COMMISSION",
  "LEAD_GENERATION",
  "ADVERTISING",
  "LICENSING",
  "DATA_PRODUCT",
  "SERVICE",
  "B2B_SAAS",
  "CONSUMER_APP",
  "HYBRID",
] as const;
export type BusinessModelType = (typeof BUSINESS_MODEL_TYPES)[number];

export const MARKET_SIZE_METHODS = ["TOP_DOWN", "BOTTOM_UP", "VALUE_THEORY"] as const;
export type MarketSizeMethod = (typeof MARKET_SIZE_METHODS)[number];
