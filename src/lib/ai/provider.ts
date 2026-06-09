/**
 * AI provider abstraction (spec §4).
 * Adding a provider = new class implementing AiProvider — zero refactor elsewhere.
 */

export type ChatRole = "user" | "assistant";

export interface ChatMsg {
  role: ChatRole;
  content: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface GenerateInput {
  system: string;
  messages: ChatMsg[]; // reduced conversation history
  context?: string; // RAG + corrections injected (Fase 2)
  temperature?: number;
  modelId: string;
  maxTokens?: number;
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
}

export interface AiProvider {
  generate(input: GenerateInput): Promise<GenerateResult>;
  /** Optional embeddings (RAG via Titan). */
  embed?(texts: string[]): Promise<number[][]>;
}
