import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { extractJson } from "./json";
import type { AIProvider, GenerateRequest, GenerateResult } from "@/domain/agent/ai-provider";

/** USD per million tokens (input, output). Unknown models fall back to the Opus tier. */
const PRICING: Record<string, { input: number; output: number }> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";

function priceOf(model: string) {
  return PRICING[model] ?? PRICING[DEFAULT_ANTHROPIC_MODEL];
}

/**
 * Claude via the official SDK. Output is requested as JSON matching the
 * Zod schema (embedded as JSON Schema) and validated before returning —
 * invalid output throws, and the agent runner falls back to deterministic logic.
 * Server-side refusal fallbacks are enabled ("default" routing).
 */
export class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  readonly isLLM = true;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    readonly model: string = DEFAULT_ANTHROPIC_MODEL,
    private readonly effort: "low" | "medium" | "high" = "medium",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }

  estimateCost(inputChars: number, maxOutputTokens: number): number {
    const p = priceOf(this.model);
    // ~1 token per 2 chars is conservative for mixed Japanese/English text.
    const inputTokens = Math.ceil(inputChars / 2);
    return (inputTokens * p.input + maxOutputTokens * p.output) / 1_000_000;
  }

  /**
   * Credential + connectivity check that generates nothing: the token
   * counting endpoint is free, so readiness checks cost $0.
   */
  async ping(): Promise<{ detail: string }> {
    const r = await this.client.messages.countTokens({ model: this.model, messages: [{ role: "user", content: "ping" }] });
    return { detail: `count_tokens ok (${r.input_tokens} tokens, model ${this.model})` };
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = JSON.stringify(z.toJSONSchema(req.schema, { io: "input", unrepresentable: "any" }));
    const response = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: req.maxOutputTokens ?? 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: this.effort },
      system: `${req.system}\n\nReturn ONLY a JSON value that validates against this JSON Schema:\n${jsonSchema}`,
      messages: [{ role: "user", content: req.prompt }],
    });
    if (response.stop_reason === "refusal") throw new Error(`${req.agent}: model declined the request`);
    if (response.stop_reason === "max_tokens") throw new Error(`${req.agent}: output truncated (max_tokens)`);
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const output = req.schema.parse(extractJson(text));
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    const p = priceOf(response.model);
    return {
      output,
      usage,
      costUsd: (usage.inputTokens * p.input + usage.outputTokens * p.output) / 1_000_000,
      provider: this.id,
      model: response.model,
    };
  }
}
