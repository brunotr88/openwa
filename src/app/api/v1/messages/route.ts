/**
 * API privata — accetta una richiesta di invio e la mette in coda.
 * Auth: header X-Api-Key (scope "messages:send"). Modi: text/template/intent.
 * Risposta 202 { jobId }. Gate opt-in: solo contatti IN o che hanno scritto;
 * `optIn:true` dichiara il consenso per numeri nuovi (registrato in audit).
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { authenticateApiKey, hasScope } from "@/lib/api-auth";
import {
  enqueueOutbound,
  resolveSendableContact,
  ensureConversation,
} from "@/lib/outbound/enqueue";
import type { OutboundPayload } from "@/lib/outbound/types";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    to: z.string().min(6).max(40),
    mode: z.enum(["text", "template", "intent"]),
    text: z.string().min(1).max(4096).optional(),
    templateId: z.string().min(1).optional(),
    vars: z.record(z.string()).optional(),
    intent: z.string().min(1).max(2000).optional(),
    context: z.record(z.unknown()).optional(),
    optIn: z.boolean().optional(),
    scheduledAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((b) => b.mode !== "text" || (b.text && b.text.length > 0), {
    message: "text richiesto per mode=text",
  })
  .refine((b) => b.mode !== "template" || !!b.templateId, {
    message: "templateId richiesto per mode=template",
  })
  .refine((b) => b.mode !== "intent" || (b.intent && b.intent.length > 0), {
    message: "intent richiesto per mode=intent",
  });

export async function POST(req: Request): Promise<Response> {
  const actor = await authenticateApiKey(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!hasScope(actor, "messages:send")) {
    return Response.json({ error: "forbidden", need: "messages:send" }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const b = parsed.data;

  if (!actor.sessionId) {
    return Response.json({ error: "number_unavailable", hint: "la API key non è legata a un numero" }, { status: 409 });
  }
  const session = await db.waSession.findFirst({
    where: { id: actor.sessionId, deletedAt: null },
    select: { id: true },
  });
  if (!session) return Response.json({ error: "number_unavailable" }, { status: 409 });

  if (b.mode === "template") {
    const tpl = await db.template.findFirst({
      where: { id: b.templateId!, tenantId: actor.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!tpl) return Response.json({ error: "template non valido" }, { status: 400 });
  }

  const contact = await resolveSendableContact(actor.tenantId, b.to, b.optIn === true);
  if (!contact.optedIn) {
    return Response.json(
      { error: "opt_in_required", hint: "il contatto non ha consenso né ha mai scritto; passa optIn:true se l'app ha raccolto il consenso" },
      { status: 403 }
    );
  }

  const conversationId = await ensureConversation(actor.tenantId, contact.id, session.id);

  const mode = b.mode.toUpperCase() as "TEXT" | "TEMPLATE" | "INTENT";
  const payload: OutboundPayload =
    mode === "TEXT"
      ? { mode: "TEXT", text: b.text! }
      : mode === "TEMPLATE"
        ? { mode: "TEMPLATE", templateId: b.templateId!, vars: b.vars ?? {} }
        : { mode: "INTENT", intent: b.intent!, context: b.context };

  const jobId = await enqueueOutbound({
    tenantId: actor.tenantId,
    sessionId: session.id,
    contactId: contact.id,
    conversationId,
    mode,
    payload,
    source: "API",
    scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
  });

  await auditLog({
    tenantId: actor.tenantId,
    action: "api.message.enqueued",
    entity: "OutboundJob",
    entityId: jobId,
    meta: { keyId: actor.keyId, mode, to: b.to, optInAsserted: b.optIn === true },
  });

  return Response.json({ jobId, status: "PENDING" }, { status: 202 });
}
