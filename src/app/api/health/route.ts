/**
 * Minimal healthcheck (blueprint §3): "ok" / 503 only — no version, no DB info.
 */
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  } catch {
    return new Response("503", {
      status: 503,
      headers: { "content-type": "text/plain" },
    });
  }
}
