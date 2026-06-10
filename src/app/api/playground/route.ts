/**
 * Bot playground (M4, M5) — genera una risposta di prova con i settings del
 * tenant (o un draft non salvato), SENZA inviare nulla su WhatsApp.
 * Appuntamenti (M5): se provider=google_calendar, esegue il tool-loop con un
 * calendario SIMULATO (MockCalendarProvider) — nessun calendario reale viene
 * letto o modificato durante le prove.
 * POST { tenantId?, messages: [{role, content}], draftSettings? } → { text }
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { getActor, resolveTenantId } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { getProvider } from "@/lib/ai";
import { runWithTools } from "@/lib/ai/tool-loop";
import { MockCalendarProvider } from "@/lib/appointments/mock";
import {
  appointmentSystemPrompt,
  buildAppointmentTools,
} from "@/lib/appointments/tools";
import {
  getTenantSettings,
  parseTenantSettings,
  deepMerge,
  buildSystemPrompt,
  styleTemperature,
  lengthMaxTokens,
  getPreset,
  MODEL_HAIKU,
} from "@/lib/settings";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  tenantId: z.string().min(1).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      })
    )
    .min(1)
    .max(30),
  /** Settings non ancora salvati (prova prima di salvare). */
  draftSettings: z.record(z.unknown()).optional(),
});

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  // 30 generazioni/min per utente — il playground non deve bruciare budget.
  const rl = rateLimit(`playground:${actor.userId}`, 30, 60_000);
  if (!rl.allowed) {
    return Response.json({ error: "rate limited" }, { status: 429 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const tenantId = await resolveTenantId(actor, parsed.data.tenantId ?? null);
  if (!tenantId) {
    return Response.json(
      { error: parsed.data.tenantId ? "forbidden" : "no tenant available" },
      { status: parsed.data.tenantId ? 403 : 400 }
    );
  }

  const saved = await getTenantSettings(tenantId);
  const settings = parsed.data.draftSettings
    ? parseTenantSettings(deepMerge(saved, parsed.data.draftSettings))
    : saved;

  // Ultimo messaggio deve essere dell'utente.
  const messages = parsed.data.messages;
  if (messages[messages.length - 1].role !== "user") {
    return Response.json({ error: "last message must be from user" }, { status: 400 });
  }

  const aiConfig = await db.aiConfig.findUnique({ where: { tenantId } });
  const preset = getPreset(settings.persona.presetId);
  const modelId = aiConfig?.modelId ?? preset?.recommendedModelId ?? MODEL_HAIKU;

  let system = buildSystemPrompt(settings);
  // Nel playground le istruzioni appuntamenti valgono anche senza calendarId:
  // il calendario è comunque simulato (si prova PRIMA di configurare Google).
  const promptSettings =
    settings.appointments.provider === "google_calendar" &&
    !settings.appointments.googleCalendarId.trim()
      ? {
          ...settings,
          appointments: { ...settings.appointments, googleCalendarId: "playground" },
        }
      : settings;
  const apptPrompt = appointmentSystemPrompt(promptSettings);
  if (apptPrompt) system = `${system}\n\n${apptPrompt}`;

  const generateInput = {
    system,
    messages,
    modelId,
    temperature: styleTemperature(settings.behavior.responseStyle),
    maxTokens: lengthMaxTokens(settings.behavior.maxResponseLength),
  };

  try {
    const provider = getProvider({ provider: aiConfig?.provider ?? "BEDROCK" });

    // Appuntamenti Google: tool-loop su calendario SIMULATO (mai quello vero).
    if (settings.appointments.provider === "google_calendar") {
      const { tools, executors } = buildAppointmentTools({
        settings,
        calendar: new MockCalendarProvider(),
        allowBooking: true, // prenotazione finta: nessun effetto reale
        simulated: true,
      });
      const result = await runWithTools(
        provider,
        { ...generateInput, maxTokens: Math.max(generateInput.maxTokens, 600), tools },
        executors
      );
      return Response.json({ text: result.text.trim() });
    }

    const result = await provider.generate(generateInput);
    return Response.json({ text: result.text.trim() });
  } catch (e) {
    console.error("[playground] generate failed:", e);
    return Response.json({ error: "generation failed" }, { status: 502 });
  }
}
