import type { AIProvider } from "@/domain/agent/ai-provider";
import { parseDirectiveByRules } from "@/domain/research/directive-parser";
import { ResearchDirectiveSchema, type ResearchDirective, type ResearchRequest } from "@/domain/research/directive";
import { buildAgentPrompt, composeSystem } from "@/domain/agent/prompt-boundary";

export const MARKET_DIRECTOR = "MarketDirectorAgent";

const SYSTEM = `You are MarketDirectorAgent of MARKET RADAR OS.
Convert a user's research request into a structured research directive.
Rules:
- Only use information present in the request. Do not invent markets, numbers or facts.
- countries: ISO-3166 alpha-2 codes, or "GLOBAL".
- languages: ISO-639-1 codes.
- keywords: short search phrases (Japanese and/or English) that would surface complaints, requests, workarounds, switching or willingness to pay.
- Respond with JSON only.`;

/**
 * Directive parsing. With an LLM provider the output is schema-validated and
 * user-controlled limits (max items, budget, sources) are re-applied so the
 * model cannot raise them. Falls back to the deterministic parser.
 */
export async function parseDirective(
  request: ResearchRequest,
  provider: AIProvider | null,
): Promise<{ directive: ResearchDirective; parser: "rule" | "ai"; usage?: { inputTokens: number; outputTokens: number }; costUsd: number; fallbackReason?: string }> {
  const rules = parseDirectiveByRules(request);
  if (!provider || !provider.isLLM) return { directive: rules, parser: "rule", costUsd: 0 };
  try {
    const res = await provider.generate({
      agent: MARKET_DIRECTOR,
      system: composeSystem(SYSTEM),
      prompt: buildAgentPrompt({
        task: "Convert the user directive into a research directive. Return fields: objective, countries, languages, personas, categories, keywords, negativeKeywords, timeRange.",
        directive: request.input,
      }),
      schema: ResearchDirectiveSchema.partial(),
      maxOutputTokens: 800,
    });
    const merged = ResearchDirectiveSchema.parse({
      ...rules,
      ...res.output,
      rawInput: rules.rawInput,
      // User-controlled limits always win over model output.
      maxItems: rules.maxItems,
      budgetLimitUsd: rules.budgetLimitUsd,
      deepResearch: rules.deepResearch,
      sourcePreferences: rules.sourcePreferences,
      ...(request.countries?.length ? { countries: rules.countries } : {}),
      ...(request.languages?.length ? { languages: rules.languages } : {}),
      ...(request.timeRangePreset ? { timeRange: rules.timeRange } : {}),
    });
    return { directive: merged, parser: "ai", usage: res.usage, costUsd: res.costUsd };
  } catch (e) {
    return {
      directive: rules,
      parser: "rule",
      costUsd: 0,
      fallbackReason: e instanceof Error ? e.message : String(e),
    };
  }
}
