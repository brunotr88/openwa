/**
 * AI provider factory (spec §4). Selects implementation per-tenant AiConfig.
 */
import type { AiProvider } from "./provider";
import { BedrockProvider } from "./bedrock";

export type { AiProvider, ChatMsg, TokenUsage, GenerateInput, GenerateResult } from "./provider";
export { BedrockProvider } from "./bedrock";

export interface AiConfigLike {
  provider: "BEDROCK" | "OPENAI";
}

/** Returns the AiProvider implementation for the given tenant config. */
export function getProvider(aiConfig: AiConfigLike): AiProvider {
  switch (aiConfig.provider) {
    case "BEDROCK":
      return new BedrockProvider();
    case "OPENAI":
      throw new Error("OpenAI provider not implemented (Fase 4)");
    default: {
      const exhaustive: never = aiConfig.provider;
      throw new Error(`Unknown AI provider: ${String(exhaustive)}`);
    }
  }
}
