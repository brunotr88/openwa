/**
 * TenantSettings — load/save + composizione system prompt (M4).
 *
 * - getTenantSettings(tenantId): merge del JSON salvato sopra
 *   recommendedDefaults, validato con zod (mai throw: fallback ai default).
 * - saveTenantSettings(tenantId, patch): deep-merge + validazione + persist.
 * - buildSystemPrompt(settings, contactSummary?): prompt preset con
 *   {{placeholders}} risolti + regole fai/non-fare + guardrail + disclosure.
 * - helper puri: applyPreset, matchEscalationKeyword, isWithinSchedule,
 *   styleTemperature, lengthMaxTokens.
 */
import { db } from "@/lib/db";
import {
  tenantSettingsSchema,
  type TenantSettings,
  type ResponseStyle,
  type MaxResponseLength,
  type HoursSettings,
} from "./schema";
import {
  recommendedDefaults,
  RESPONSE_STYLE_TEMPERATURE,
  RESPONSE_LENGTH_CHARS,
  RESPONSE_LENGTH_MAX_TOKENS,
} from "./defaults";
import { getPreset } from "./presets";
import { deepMerge, isPlainObject, parseTenantSettings } from "./merge";

export * from "./schema";
export * from "./defaults";
export * from "./presets";
export * from "./merge";

// ─── Load / save ─────────────────────────────────────────────────────────────

export async function getTenantSettings(tenantId: string): Promise<TenantSettings> {
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { settings: true },
  });
  return parseTenantSettings(tenant?.settings ?? null);
}

/**
 * Deep-merge del patch sopra i settings correnti, validazione zod e persist.
 * Ritorna i settings completi salvati. Throws ZodError se il patch è invalido.
 */
export async function saveTenantSettings(
  tenantId: string,
  patch: unknown
): Promise<TenantSettings> {
  const current = await getTenantSettings(tenantId);
  const merged = deepMerge(current, isPlainObject(patch) ? patch : {});
  const next = tenantSettingsSchema.parse(merged);
  await db.tenant.update({
    where: { id: tenantId },
    data: { settings: next },
  });
  return next;
}

// ─── Preset apply ────────────────────────────────────────────────────────────

/**
 * Applica un preset: persona.presetId + override tono/registro/emoji/stile.
 * Nota: NON cambia behavior.aiMode — attivare il bot è un passo esplicito
 * dell'utente (wizard step 5 / pagina comportamento).
 */
export function applyPreset(settings: TenantSettings, presetId: string): TenantSettings {
  const preset = getPreset(presetId);
  if (!preset) return settings;
  return {
    ...settings,
    persona: {
      ...settings.persona,
      presetId: preset.id,
      tone: preset.overrides.tone,
      formality: preset.overrides.formality,
      emojiUsage: preset.overrides.emojiUsage,
    },
    behavior: {
      ...settings.behavior,
      responseStyle: preset.overrides.responseStyle,
    },
  };
}

// ─── Mappature stile/lunghezza ───────────────────────────────────────────────

export function styleTemperature(style: ResponseStyle): number {
  return RESPONSE_STYLE_TEMPERATURE[style];
}

export function lengthMaxTokens(length: MaxResponseLength): number {
  return RESPONSE_LENGTH_MAX_TOKENS[length];
}

// ─── Escalation keywords ─────────────────────────────────────────────────────

/**
 * Match parziale case-insensitive (ai-strategies.md: meglio un falso positivo
 * che un falso negativo). Ritorna la keyword che ha fatto match, o null.
 */
export function matchEscalationKeyword(
  text: string | null | undefined,
  keywords: string[]
): string | null {
  if (!text) return null;
  const haystack = text.toLowerCase();
  for (const kw of keywords) {
    const needle = kw.trim().toLowerCase();
    if (needle && haystack.includes(needle)) return kw;
  }
  return null;
}

// ─── Orari (schedule per giorno, timezone-aware) ─────────────────────────────

function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  return Number(m[1]) + Number(m[2]) / 60;
}

/** Giorno (0=dom) e ora decimale di `now` nella timezone indicata. */
function zonedDayHour(timezone: string, now: Date): { day: number; hour: number } {
  let day = now.getDay();
  let hour = now.getHours() + now.getMinutes() / 60;
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? NaN);
    const min = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    const idx = dayNames.indexOf(wd);
    if (idx >= 0 && !Number.isNaN(h)) {
      day = idx;
      hour = (h % 24) + min / 60;
    }
  } catch {
    // timezone invalida → ora locale del server
  }
  return { day, hour };
}

/** True se `now` cade negli orari di attività configurati. */
export function isWithinSchedule(hours: HoursSettings, now: Date = new Date()): boolean {
  const { day, hour } = zonedDayHour(hours.timezone, now);
  const slot = hours.schedule[day];
  if (!slot || !slot.enabled) return false;
  const start = parseHHMM(slot.start);
  const end = parseHHMM(slot.end);
  if (start === null || end === null) return true;
  // Finestra overnight (es. 20:00→02:00): end <= start ⇒ attraversa la mezzanotte.
  if (end <= start) return hour >= start || hour < end;
  return hour >= start && hour < end;
}

/**
 * True se l'invio automatico AI è permesso in questo momento secondo
 * afterHoursMode (sostituisce il vecchio businessHours su AiConfig):
 * - ai_sempre:        sempre permesso (default consigliato — AI 24/7)
 * - ai_fuori_orario:  permesso solo FUORI orario (in orario risponde il team)
 * - solo_assenza:     mai invio automatico (solo bozze per l'operatore)
 */
export function autoSendAllowedNow(hours: HoursSettings, now: Date = new Date()): boolean {
  switch (hours.afterHoursMode) {
    case "ai_sempre":
      return true;
    case "ai_fuori_orario":
      return !isWithinSchedule(hours, now);
    case "solo_assenza":
      return false;
  }
}

// ─── System prompt ───────────────────────────────────────────────────────────

const NAME_PLACEHOLDERS = [
  "nome_attivita",
  "nome_studio",
  "nome_agenzia",
  "nome_azienda",
  "nome_struttura",
  "nome_palestra",
];

/** Fallback per i placeholder non-nome quando l'utente non li ha forniti. */
const PRESET_PLACEHOLDER_FALLBACKS: Record<string, Record<string, string>> = {
  studio_professionale: { tipo: "professionale" },
  bellezza: { tipo: "centro estetico" },
  hotel: { tipo: "struttura ricettiva" },
  ecommerce: { categoria_prodotti: "prodotti per i propri clienti" },
  assistenza_it: { servizi: "servizi di assistenza informatica" },
};

function resolvePlaceholders(prompt: string, settings: TenantSettings): string {
  const businessName = settings.persona.businessName.trim() || "questa attività";
  let out = prompt;
  for (const ph of NAME_PLACEHOLDERS) {
    out = out.replaceAll(`{{${ph}}}`, businessName);
  }
  const city = settings.persona.city.trim();
  if (city) {
    out = out.replaceAll("{{citta}}", city);
  } else {
    // rimuove " a {{citta}}" / " di {{citta}}" senza rompere la frase
    out = out.replace(/\s+(?:a|di|in)\s+\{\{citta\}\}/g, "").replaceAll("{{citta}}", "");
  }
  const fallbacks = PRESET_PLACEHOLDER_FALLBACKS[settings.persona.presetId ?? ""] ?? {};
  for (const [key, value] of Object.entries(fallbacks)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  // qualunque placeholder residuo viene rimosso
  return out.replace(/\{\{[a-z_]+\}\}/g, "").replace(/[ \t]{2,}/g, " ");
}

const TONE_LINES: Record<TenantSettings["persona"]["tone"], string> = {
  professionale: "Mantieni un tono professionale, cortese e diretto.",
  amichevole: "Mantieni un tono amichevole e accogliente.",
  entusiasta: "Mantieni un tono energico ed entusiasta, senza esagerare.",
  formale: "Mantieni un tono formale e sobrio.",
};

const FORMALITY_LINES: Record<TenantSettings["persona"]["formality"], string> = {
  lei: "Dai sempre del Lei al cliente.",
  tu: "Dai del tu al cliente.",
  auto: "Adegua il registro (tu/Lei) a quello usato dal cliente.",
};

const EMOJI_LINES: Record<TenantSettings["persona"]["emojiUsage"], string> = {
  nessuna: "Non usare emoji.",
  moderata: "Usa al massimo 1-2 emoji per messaggio, solo quando aggiungono calore.",
  libera: "Puoi usare le emoji liberamente, restando professionale.",
};

const LENGTH_LINES: Record<MaxResponseLength, string> = {
  breve: `Risposte brevi: 2-4 frasi, massimo ~${RESPONSE_LENGTH_CHARS.breve} caratteri.`,
  media: `Risposte di media lunghezza: massimo ~${RESPONSE_LENGTH_CHARS.media} caratteri.`,
  lunga: `Risposte fino a ~${RESPONSE_LENGTH_CHARS.lunga} caratteri quando serve, ma resta conciso.`,
};

/**
 * Compone il system prompt finale dal preset + impostazioni tenant.
 * Ordine: identità (preset) → contesto attività → stile → regole →
 * guardrail → disclosure → istruzioni custom → scheda contatto.
 */
export interface PromptContext {
  /** Scheda contatto / note operatore. */
  contactSummary?: string | null;
  /** True quando il messaggio arriva fuori dagli orari di attività. */
  outsideBusinessHours?: boolean;
}

export function buildSystemPrompt(
  settings: TenantSettings,
  contactSummaryOrContext?: string | null | PromptContext
): string {
  const ctx: PromptContext =
    typeof contactSummaryOrContext === "string" || contactSummaryOrContext == null
      ? { contactSummary: contactSummaryOrContext }
      : contactSummaryOrContext;
  const contactSummary = ctx.contactSummary;
  const { persona, behavior } = settings;
  const preset = getPreset(persona.presetId);
  const parts: string[] = [];

  if (preset) {
    parts.push(resolvePlaceholders(preset.systemPrompt, settings));
  } else {
    const name = persona.businessName.trim() || "questa attività";
    parts.push(
      `Sei l'assistente WhatsApp di ${name}. Rispondi in modo conciso, utile e cortese alle domande dei clienti.`
    );
  }

  if (persona.botName.trim()) {
    parts.push(`Ti chiami ${persona.botName.trim()}.`);
  }

  if (persona.businessDescription.trim()) {
    parts.push(`Informazioni sull'attività:\n${persona.businessDescription.trim()}`);
  }

  parts.push(
    [
      "Stile di comunicazione:",
      `- ${TONE_LINES[persona.tone]}`,
      `- ${FORMALITY_LINES[persona.formality]}`,
      `- ${EMOJI_LINES[persona.emojiUsage]}`,
      `- ${LENGTH_LINES[behavior.maxResponseLength]}`,
      "- Niente markdown: WhatsApp supporta solo *grassetto* e _corsivo_. Una domanda alla volta.",
      persona.language === "it"
        ? "- Rispondi in italiano; se il cliente scrive in un'altra lingua, usa la sua."
        : `- Rispondi in "${persona.language}"; se il cliente scrive in un'altra lingua, usa la sua.`,
    ].join("\n")
  );

  if (behavior.doRules.length > 0) {
    parts.push(
      "Cose da fare sempre:\n" + behavior.doRules.map((r) => `- ${r}`).join("\n")
    );
  }
  if (behavior.dontRules.length > 0) {
    parts.push(
      "Cose da non fare mai:\n" + behavior.dontRules.map((r) => `- ${r}`).join("\n")
    );
  }
  if (behavior.forbiddenTopics.length > 0) {
    parts.push(
      `Argomenti vietati (declina sempre, con gentilezza): ${behavior.forbiddenTopics.join(", ")}.`
    );
  }

  if (behavior.priceGuardrail) {
    parts.push(
      "Guardrail prezzi: cita esclusivamente prezzi, promozioni e condizioni presenti nelle informazioni fornite. Mai stime, sconti o codici improvvisati."
    );
  }
  if (behavior.escalateOnUncertainty) {
    parts.push(
      "Se non conosci la risposta, non inventare: dillo chiaramente e proponi il passaggio a un operatore."
    );
  }
  parts.push(
    "Se il cliente chiede di parlare con una persona, conferma subito che un operatore lo ricontatterà al più presto."
  );
  if (behavior.aiDisclosure) {
    parts.push(
      "Nel primo messaggio della conversazione presentati come assistente virtuale (AI) dell'attività."
    );
  }
  if (behavior.welcomeMessageEnabled) {
    parts.push(
      "Al primo contatto saluta il cliente e spiega in una frase cosa puoi fare per lui."
    );
  }
  if (ctx.outsideBusinessHours && settings.hours.afterHoursDisclaimer) {
    parts.push(
      "In questo momento il team non è disponibile (fuori orario di attività): dillo al cliente con gentilezza e spiega che un operatore risponderà alla riapertura."
    );
  }

  if (behavior.customInstructions.trim()) {
    parts.push(`Istruzioni aggiuntive:\n${behavior.customInstructions.trim()}`);
  }

  if (contactSummary?.trim()) {
    parts.push(`Note sul contatto:\n${contactSummary.trim()}`);
  }

  return parts.join("\n\n");
}
