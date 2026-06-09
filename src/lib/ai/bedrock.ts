/**
 * AWS Bedrock provider (spec §4, Bedrock guide).
 * - Chat via Converse API, region from BEDROCK_REGION, inference profile `eu.*` modelIds.
 * - Embeddings via InvokeModel + amazon.titan-embed-text-v2:0.
 * Credentials from BEDROCK_ACCESS_KEY_ID / BEDROCK_SECRET_ACCESS_KEY.
 */
import {
  BedrockRuntimeClient,
  ConverseCommand,
  InvokeModelCommand,
  type Message,
} from "@aws-sdk/client-bedrock-runtime";
import type {
  AiProvider,
  GenerateInput,
  GenerateResult,
} from "./provider";

const EMBED_MODEL_ID = "amazon.titan-embed-text-v2:0";
const DEFAULT_MAX_TOKENS = 2000;

export class BedrockProvider implements AiProvider {
  private client: BedrockRuntimeClient;

  constructor(client?: BedrockRuntimeClient) {
    if (client) {
      this.client = client;
      return;
    }

    const region = process.env.BEDROCK_REGION;
    if (!region) throw new Error("BEDROCK_REGION required");

    const accessKeyId = process.env.BEDROCK_ACCESS_KEY_ID;
    const secretAccessKey = process.env.BEDROCK_SECRET_ACCESS_KEY;

    this.client = new BedrockRuntimeClient({
      region,
      // When keys are absent, fall back to the default credential chain
      // (e.g. IAM role) — useful in some deploy targets.
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });
  }

  async generate(input: GenerateInput): Promise<GenerateResult> {
    const messages: Message[] = input.messages.map((m) => ({
      role: m.role,
      content: [{ text: m.content }],
    }));

    // Inject RAG/correction context (Fase 2) as a trailing system block.
    const systemBlocks = [{ text: input.system }];
    if (input.context) {
      systemBlocks.push({ text: input.context });
    }

    const res = await this.client.send(
      new ConverseCommand({
        modelId: input.modelId,
        messages,
        system: systemBlocks,
        inferenceConfig: {
          maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: input.temperature ?? 0.5,
        },
      })
    );

    return {
      text: res.output?.message?.content?.[0]?.text ?? "",
      usage: {
        inputTokens: res.usage?.inputTokens ?? 0,
        outputTokens: res.usage?.outputTokens ?? 0,
      },
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];

    for (const text of texts) {
      const res = await this.client.send(
        new InvokeModelCommand({
          modelId: EMBED_MODEL_ID,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify({ inputText: text }),
        })
      );

      const decoded = JSON.parse(
        new TextDecoder().decode(res.body)
      ) as { embedding: number[] };
      out.push(decoded.embedding);
    }

    return out;
  }
}
