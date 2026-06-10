/**
 * AI provider abstraction (spec §4, M5 tool use).
 * Adding a provider = new class implementing AiProvider — zero refactor elsewhere.
 */

export type ChatRole = "user" | "assistant";

/**
 * Content blocks (M5): a message is either plain text or a list of blocks.
 * Shapes mirror the Bedrock Converse API (the only implementation today) but
 * are provider-agnostic by contract.
 */
export type ContentBlock =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | {
      toolResult: {
        toolUseId: string;
        content: Array<{ text?: string; json?: unknown }>;
        status?: "success" | "error";
      };
    };

export interface ChatMsg {
  role: ChatRole;
  content: string | ContentBlock[];
}

/** Tool declaration passed to the model (JSON-schema input). */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema of the tool input (type: object, properties, required...). */
  inputSchema: Record<string, unknown>;
}

/** A tool invocation requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
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
  /** Tools the model may call (M5). Omit/empty = plain text generation. */
  tools?: ToolSpec[];
}

export interface GenerateResult {
  text: string;
  usage: TokenUsage;
  /** Present when the model stopped to call tools (stopReason tool_use). */
  toolCalls?: ToolCall[];
}

export interface AiProvider {
  generate(input: GenerateInput): Promise<GenerateResult>;
  /** Optional embeddings (RAG via Titan). */
  embed?(texts: string[]): Promise<number[][]>;
}
