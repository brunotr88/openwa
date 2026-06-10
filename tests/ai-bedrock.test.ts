import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the AWS SDK before importing the provider.
// `send` is hoisted with the vi.mock factory; prefix `mock` is required by vitest.
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));
const send = mockSend;

vi.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: class {
    send = mockSend;
  },
  ConverseCommand: class {
    constructor(public input: unknown) {}
  },
  InvokeModelCommand: class {
    constructor(public input: unknown) {}
  },
}));

import { BedrockProvider } from "../src/lib/ai/bedrock";

describe("BedrockProvider.generate", () => {
  beforeEach(() => {
    send.mockReset();
    process.env.BEDROCK_REGION = "eu-central-1";
    process.env.BEDROCK_ACCESS_KEY_ID = "AKIA_TEST";
    process.env.BEDROCK_SECRET_ACCESS_KEY = "secret_test";
  });

  it("maps messages to Converse and returns { text, usage }", async () => {
    send.mockResolvedValue({
      output: { message: { content: [{ text: "Ciao!" }] } },
      usage: { inputTokens: 12, outputTokens: 5 },
    });

    const provider = new BedrockProvider();
    const result = await provider.generate({
      system: "You are a helpful WA assistant.",
      messages: [
        { role: "user", content: "Ciao" },
        { role: "assistant", content: "Salve" },
        { role: "user", content: "Come stai?" },
      ],
      modelId: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
      temperature: 0.3,
    });

    expect(result).toEqual({
      text: "Ciao!",
      usage: { inputTokens: 12, outputTokens: 5 },
    });

    // Inspect the command the provider built.
    const cmd = send.mock.calls[0][0] as { input: any };
    expect(cmd.input.modelId).toBe(
      "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"
    );
    expect(cmd.input.system).toEqual([
      { text: "You are a helpful WA assistant." },
    ]);
    expect(cmd.input.inferenceConfig.temperature).toBe(0.3);
    expect(cmd.input.messages).toEqual([
      { role: "user", content: [{ text: "Ciao" }] },
      { role: "assistant", content: [{ text: "Salve" }] },
      { role: "user", content: [{ text: "Come stai?" }] },
    ]);
  });

  it("appends context as an extra system block when provided", async () => {
    send.mockResolvedValue({
      output: { message: { content: [{ text: "ok" }] } },
      usage: { inputTokens: 1, outputTokens: 1 },
    });

    const provider = new BedrockProvider();
    await provider.generate({
      system: "base",
      context: "RAG context",
      messages: [{ role: "user", content: "hi" }],
      modelId: "eu.amazon.nova-lite-v1:0",
    });

    const cmd = send.mock.calls[0][0] as { input: any };
    expect(cmd.input.system).toEqual([
      { text: "base" },
      { text: "RAG context" },
    ]);
  });

  it("defaults missing usage fields to 0", async () => {
    send.mockResolvedValue({ output: { message: { content: [] } } });
    const provider = new BedrockProvider();
    const result = await provider.generate({
      system: "s",
      messages: [{ role: "user", content: "x" }],
      modelId: "eu.amazon.nova-micro-v1:0",
    });
    expect(result.text).toBe("");
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("passes toolConfig and returns toolCalls on stopReason tool_use (M5)", async () => {
    send.mockResolvedValue({
      stopReason: "tool_use",
      output: {
        message: {
          content: [
            { text: "Controllo la disponibilità…" },
            {
              toolUse: {
                toolUseId: "tu-1",
                name: "check_availability",
                input: { date: "2026-06-15" },
              },
            },
          ],
        },
      },
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    const provider = new BedrockProvider();
    const schema = {
      type: "object",
      properties: { date: { type: "string" } },
    };
    const result = await provider.generate({
      system: "s",
      messages: [
        { role: "user", content: "Avete posto lunedì?" },
        {
          role: "user",
          content: [
            {
              toolResult: {
                toolUseId: "prev",
                content: [{ json: { ok: true } }],
                status: "success",
              },
            },
          ],
        },
      ],
      modelId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
      tools: [
        {
          name: "check_availability",
          description: "Controlla gli orari liberi",
          inputSchema: schema,
        },
      ],
    });

    expect(result.toolCalls).toEqual([
      { id: "tu-1", name: "check_availability", input: { date: "2026-06-15" } },
    ]);
    expect(result.text).toBe("Controllo la disponibilità…");

    const cmd = send.mock.calls[0][0] as { input: any };
    expect(cmd.input.toolConfig.tools).toEqual([
      {
        toolSpec: {
          name: "check_availability",
          description: "Controlla gli orari liberi",
          inputSchema: { json: schema },
        },
      },
    ]);
    // block-style messages pass through unchanged
    expect(cmd.input.messages[1].content[0].toolResult.toolUseId).toBe("prev");
  });

  it("omits toolConfig when no tools are declared", async () => {
    send.mockResolvedValue({
      output: { message: { content: [{ text: "ok" }] } },
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const provider = new BedrockProvider();
    const result = await provider.generate({
      system: "s",
      messages: [{ role: "user", content: "ciao" }],
      modelId: "eu.amazon.nova-micro-v1:0",
    });
    expect(result.toolCalls).toBeUndefined();
    const cmd = send.mock.calls[0][0] as { input: any };
    expect(cmd.input.toolConfig).toBeUndefined();
  });
});

describe("BedrockProvider.embed", () => {
  beforeEach(() => {
    send.mockReset();
    process.env.BEDROCK_REGION = "eu-central-1";
  });

  it("invokes Titan and returns embedding vectors", async () => {
    const encode = (obj: unknown) =>
      new TextEncoder().encode(JSON.stringify(obj));
    send
      .mockResolvedValueOnce({ body: encode({ embedding: [0.1, 0.2] }) })
      .mockResolvedValueOnce({ body: encode({ embedding: [0.3, 0.4] }) });

    const provider = new BedrockProvider();
    const vectors = await provider.embed(["a", "b"]);

    expect(vectors).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const cmd = send.mock.calls[0][0] as { input: any };
    expect(cmd.input.modelId).toBe("amazon.titan-embed-text-v2:0");
    expect(JSON.parse(cmd.input.body)).toEqual({ inputText: "a" });
  });
});
