// Gateway bootstrap.
//
//   1. load env
//   2. instantiate BaileysEngine
//   3. wire engine.onMessage(handleInbound) and a status-change persister
//   4. start the internal HTTP server on PORT (default 8080)
//   5. auto-resume sessions whose WaSession.status === 'CONNECTED'
//
// A single dying session must never bring the process down — all per-session
// work is already guarded inside the engine; here we additionally guard startup.

import "dotenv/config";
import { BaileysEngine } from "./baileys-engine";
import { handleInbound } from "./inbound";
import { createApp } from "./http";
import { db } from "./db";
import type { WaStatus } from "./engine";

const PORT = Number(process.env.PORT ?? 8080);
const INTERNAL_GATEWAY_SECRET = process.env.INTERNAL_GATEWAY_SECRET ?? "";

async function persistStatus(sessionId: string, status: WaStatus): Promise<void> {
  try {
    await db.waSession.update({
      where: { id: sessionId },
      data: { status, lastSeenAt: new Date() },
    });
  } catch (err) {
    console.error(`[index] failed to persist status for ${sessionId}:`, err);
  }
}

async function resumeConnectedSessions(engine: BaileysEngine): Promise<void> {
  let sessions: { id: string }[] = [];
  try {
    sessions = await db.waSession.findMany({
      where: { status: "CONNECTED", deletedAt: null },
      select: { id: true },
    });
  } catch (err) {
    console.error("[index] failed to query sessions to resume:", err);
    return;
  }

  for (const s of sessions) {
    try {
      console.log(`[index] resuming session ${s.id}`);
      await engine.startSession(s.id);
    } catch (err) {
      console.error(`[index] failed to resume session ${s.id}:`, err);
    }
  }
}

async function main(): Promise<void> {
  if (!INTERNAL_GATEWAY_SECRET) {
    console.warn(
      "[index] INTERNAL_GATEWAY_SECRET is empty — all guarded routes will reject requests."
    );
  }

  const engine = new BaileysEngine();
  engine.onMessage(handleInbound);
  engine.onStatusChange((sessionId, status) => {
    void persistStatus(sessionId, status);
  });

  const app = createApp({ engine, secret: INTERNAL_GATEWAY_SECRET });
  app.listen(PORT, () => {
    console.log(`[index] gateway HTTP listening on :${PORT}`);
  });

  await resumeConnectedSessions(engine);
  console.log("[index] gateway ready");
}

main().catch((err) => {
  console.error("[index] fatal bootstrap error:", err);
  process.exit(1);
});
