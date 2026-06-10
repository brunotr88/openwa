import { describe, it, expect, vi } from "vitest";

import { runWithTools } from "../src/lib/ai/tool-loop";
import type {
  AiProvider,
  GenerateInput,
  GenerateResult,
} from "../src/lib/ai/provider";

function providerFromResults(results: GenerateResult[]): {
  provider: AiProvider;
  calls: GenerateInput[];
} {
  const calls: GenerateInput[] = [];
  let i = 0;
  const provider: AiProvider = {
    async generate(input) {
      calls.push(input);
      const res = results[Math.min(i, results.length - 1)];
      i += 1;
      return res;
    },
  };
  return { provider, calls };
}

const baseInput: GenerateInput = {
  system: "sys",
  messages: [{ role: "user", content: "Vorrei un appuntamento" }],
  modelId: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
  tools: [
    {
      name: "check_availability",
      description: "Controlla la disponibilità",
      inputSchema: { type: "object", properties: {} },
    },
  ],
};

describe("runWithTools", () => {
  it("passthrough: no tool calls → single generate, result returned as-is", async () => {
    const { provider, calls } = providerFromResults([
      { text: "Ciao!", usage: { inputTokens: 10, outputTokens: 5 } },
    ]);
    const res = await runWithTools(provider, baseInput, {});
    expect(res.text).toBe("Ciao!");
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(calls).toHaveLength(1);
  });

  it("executes a tool call, appends toolResult and re-generates", async () => {
    const { provider, calls } = providerFromResults([
      {
        text: "",
        usage: { inputTokens: 10, outputTokens: 5 },
        toolCalls: [
          { id: "t1", name: "check_availability", input: { date: "2026-06-15" } },
        ],
      },
      { text: "Ecco gli orari liberi!", usage: { inputTokens: 20, outputTokens: 8 } },
    ]);

    const executor = vi.fn().mockResolvedValue({ slots: ["lun 15 giugno 09:00"] });
    const res = await runWithTools(provider, baseInput, {
      check_availability: executor,
    });

    expect(executor).toHaveBeenCalledWith({ date: "2026-06-15" });
    expect(res.text).toBe("Ecco gli orari liberi!");
    // usage cumulato
    expect(res.usage).toEqual({ inputTokens: 30, outputTokens: 13 });

    // 2a chiamata: history estesa con assistant(toolUse) + user(toolResult)
    expect(calls).toHaveLength(2);
    const second = calls[1].messages;
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe("assistant");
    expect(second[1].content).toEqual([
      {
        toolUse: {
          toolUseId: "t1",
          name: "check_availability",
          input: { date: "2026-06-15" },
        },
      },
    ]);
    expect(second[2].role).toBe("user");
    expect(second[2].content).toEqual([
      {
        toolResult: {
          toolUseId: "t1",
          content: [{ json: { slots: ["lun 15 giugno 09:00"] } }],
          status: "success",
        },
      },
    ]);
  });

  it("preserves assistant text alongside toolUse blocks", async () => {
    const { provider, calls } = providerFromResults([
      {
        text: "Controllo subito…",
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: "t1", name: "check_availability", input: {} }],
      },
      { text: "Fatto", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    await runWithTools(provider, baseInput, {
      check_availability: () => ({ ok: true }),
    });
    const assistantMsg = calls[1].messages[1];
    expect(assistantMsg.content).toEqual([
      { text: "Controllo subito…" },
      { toolUse: { toolUseId: "t1", name: "check_availability", input: {} } },
    ]);
  });

  it("executor errors become toolResult status=error (no throw)", async () => {
    const { provider, calls } = providerFromResults([
      {
        text: "",
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: "t1", name: "check_availability", input: {} }],
      },
      { text: "Mi dispiace, riprova", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const res = await runWithTools(provider, baseInput, {
      check_availability: () => {
        throw new Error("calendario non raggiungibile");
      },
    });
    expect(res.text).toBe("Mi dispiace, riprova");
    expect(calls[1].messages[2].content).toEqual([
      {
        toolResult: {
          toolUseId: "t1",
          content: [{ text: "calendario non raggiungibile" }],
          status: "error",
        },
      },
    ]);
  });

  it("unknown tool name → toolResult error, loop continues", async () => {
    const { provider, calls } = providerFromResults([
      {
        text: "",
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: "t1", name: "mystery_tool", input: {} }],
      },
      { text: "ok", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const res = await runWithTools(provider, baseInput, {});
    expect(res.text).toBe("ok");
    const block = calls[1].messages[2].content as Array<{
      toolResult: { status?: string };
    }>;
    expect(block[0].toolResult.status).toBe("error");
  });

  it("stops after maxIters tool rounds and returns the last result", async () => {
    const toolResult: GenerateResult = {
      text: "",
      usage: { inputTokens: 1, outputTokens: 1 },
      toolCalls: [{ id: "t1", name: "check_availability", input: {} }],
    };
    const { provider, calls } = providerFromResults([toolResult]);
    const executor = vi.fn().mockResolvedValue({ ok: true });

    const res = await runWithTools(
      provider,
      baseInput,
      { check_availability: executor },
      2
    );

    // maxIters=2 → 2 giri di tool + 1 chiamata finale = 3 generate
    expect(calls).toHaveLength(3);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(res.toolCalls).toHaveLength(1); // l'ultimo risultato resta com'è
    expect(res.usage).toEqual({ inputTokens: 3, outputTokens: 3 });
  });

  it("does not mutate the caller's messages array", async () => {
    const { provider } = providerFromResults([
      {
        text: "",
        usage: { inputTokens: 1, outputTokens: 1 },
        toolCalls: [{ id: "t1", name: "check_availability", input: {} }],
      },
      { text: "fine", usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    const input = { ...baseInput, messages: [...baseInput.messages] };
    await runWithTools(provider, input, { check_availability: () => ({}) });
    expect(input.messages).toHaveLength(1);
  });
});
