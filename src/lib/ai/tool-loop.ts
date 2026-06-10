/**
 * Tool loop (M5): runWithTools esegue le tool call richieste dal modello e
 * re-invoca generate finché non arriva testo finale (o si esauriscono i giri).
 *
 * - Nessun tool dichiarato → passthrough: una sola chiamata a generate.
 * - Ogni iterazione: generate → se toolCalls, esegue gli executor, appende
 *   il messaggio assistant (toolUse) + il messaggio user (toolResult) e
 *   ripete. Errori degli executor → toolResult status "error" (il modello
 *   spiega al cliente, niente throw).
 * - maxIters limita i giri di esecuzione tool (default 3). Esauriti i giri,
 *   ritorna l'ultimo risultato così com'è.
 * - usage è accumulato su tutte le chiamate.
 */
import type {
  AiProvider,
  ChatMsg,
  ContentBlock,
  GenerateInput,
  GenerateResult,
  ToolCall,
} from "./provider";

/** Executor di un tool: input JSON del modello → risultato serializzabile. */
export type ToolExecutor = (
  input: Record<string, unknown>
) => Promise<unknown> | unknown;

export type ToolExecutors = Record<string, ToolExecutor>;

/** Ricostruisce il messaggio assistant (testo + blocchi toolUse). */
function assistantMessage(result: GenerateResult): ChatMsg {
  const content: ContentBlock[] = [];
  if (result.text) content.push({ text: result.text });
  for (const call of result.toolCalls ?? []) {
    content.push({
      toolUse: { toolUseId: call.id, name: call.name, input: call.input },
    });
  }
  return { role: "assistant", content };
}

async function executeToolCall(
  call: ToolCall,
  executors: ToolExecutors
): Promise<ContentBlock> {
  const executor = executors[call.name];
  if (!executor) {
    return {
      toolResult: {
        toolUseId: call.id,
        content: [{ text: `Tool "${call.name}" non disponibile.` }],
        status: "error",
      },
    };
  }
  try {
    const value = await executor(call.input ?? {});
    return {
      toolResult: {
        toolUseId: call.id,
        content: [
          typeof value === "string" ? { text: value } : { json: value ?? {} },
        ],
        status: "success",
      },
    };
  } catch (e) {
    return {
      toolResult: {
        toolUseId: call.id,
        content: [{ text: e instanceof Error ? e.message : String(e) }],
        status: "error",
      },
    };
  }
}

/**
 * Esegue generate con tool use iterativo. Ritorna l'ultimo GenerateResult
 * (testo finale) con usage cumulato su tutte le iterazioni.
 */
export async function runWithTools(
  provider: AiProvider,
  input: GenerateInput,
  executors: ToolExecutors,
  maxIters = 3
): Promise<GenerateResult> {
  const messages: ChatMsg[] = [...input.messages];
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (let iter = 0; ; iter++) {
    const result = await provider.generate({ ...input, messages });
    usage.inputTokens += result.usage.inputTokens;
    usage.outputTokens += result.usage.outputTokens;

    const toolCalls = result.toolCalls ?? [];
    if (toolCalls.length === 0 || iter >= maxIters) {
      return { ...result, usage: { ...usage } };
    }

    messages.push(assistantMessage(result));
    const resultBlocks: ContentBlock[] = [];
    for (const call of toolCalls) {
      resultBlocks.push(await executeToolCall(call, executors));
    }
    messages.push({ role: "user", content: resultBlocks });
  }
}
