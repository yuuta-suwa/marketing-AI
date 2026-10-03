import type { AIProvider, GenerateRequest, GenerateResult } from "@/domain/agent/ai-provider";

/** Scripted LLM for tests. `respond` receives the agent name and prompt. */
export class FakeLLM implements AIProvider {
  readonly id = "fake";
  readonly model = "fake-1";
  readonly isLLM = true;
  calls: string[] = [];

  constructor(
    private readonly respond: (agent: string, prompt: string) => unknown,
    private readonly costPerCall = 0.01,
  ) {}

  estimateCost(): number {
    return this.costPerCall;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    this.calls.push(req.agent);
    const output = req.schema.parse(this.respond(req.agent, req.prompt));
    return { output, usage: { inputTokens: 100, outputTokens: 50 }, costUsd: this.costPerCall, provider: this.id, model: this.model };
  }
}
