/**
 * TenantSettings — zod schema (M4).
 * Single typed shape for Tenant.settings (Json column). All fields carry
 * defaults so a partial/empty stored object always parses into a complete
 * settings tree (merge happens in index.ts over recommendedDefaults).
 *
 * Sources: docs/research/ai-strategies.md (persona/behavior/hours),
 * docs/research/whatsapp-ops.md (sending/inbox anti-ban flags).
 */
import { z } from "zod";

// ─── Enumerations ────────────────────────────────────────────────────────────

export const toneSchema = z.enum([
  "professionale",
  "amichevole",
  "entusiasta",
  "formale",
]);
export type Tone = z.infer<typeof toneSchema>;

export const formalitySchema = z.enum(["lei", "tu", "auto"]);
export type Formality = z.infer<typeof formalitySchema>;

export const emojiUsageSchema = z.enum(["nessuna", "moderata", "libera"]);
export type EmojiUsage = z.infer<typeof emojiUsageSchema>;

export const responseStyleSchema = z.enum(["preciso", "bilanciato", "creativo"]);
export type ResponseStyle = z.infer<typeof responseStyleSchema>;

export const maxResponseLengthSchema = z.enum(["breve", "media", "lunga"]);
export type MaxResponseLength = z.infer<typeof maxResponseLengthSchema>;

export const aiModeSchema = z.enum(["AUTO", "COPILOT", "OFF"]);
export type AiMode = z.infer<typeof aiModeSchema>;

export const afterHoursModeSchema = z.enum([
  "ai_sempre",
  "ai_fuori_orario",
  "solo_assenza",
]);
export type AfterHoursMode = z.infer<typeof afterHoursModeSchema>;

export const sendProfileSchema = z.enum([
  "prudente",
  "standard",
  "aggressivo",
  "personalizzato",
]);
export type SendProfile = z.infer<typeof sendProfileSchema>;

export const groupFilterSchema = z.enum(["mostra_no_ai", "ignora"]);
export type GroupFilter = z.infer<typeof groupFilterSchema>;

// ─── Sections ────────────────────────────────────────────────────────────────

export const personaSchema = z.object({
  botName: z.string().max(60).default(""),
  businessName: z.string().max(120).default(""),
  /** Città dell'attività — usata per i {{placeholders}} dei preset. */
  city: z.string().max(80).default(""),
  businessDescription: z.string().max(2000).default(""),
  /** Preset settore (presets.ts) — null = nessun preset applicato. */
  presetId: z.string().max(40).nullable().default(null),
  tone: toneSchema.default("professionale"),
  formality: formalitySchema.default("auto"),
  emojiUsage: emojiUsageSchema.default("moderata"),
  language: z.string().max(10).default("it"),
});

export const behaviorSchema = z.object({
  /** Preciso 0.2 / Bilanciato 0.4 / Creativo 0.7 (temperature). */
  responseStyle: responseStyleSchema.default("preciso"),
  maxResponseLength: maxResponseLengthSchema.default("breve"),
  aiMode: aiModeSchema.default("COPILOT"),
  /** L'assistente si presenta come AI nel primo messaggio (AI Act). */
  aiDisclosure: z.boolean().default(true),
  doRules: z.array(z.string().max(300)).max(20).default([]),
  dontRules: z.array(z.string().max(300)).max(20).default([]),
  forbiddenTopics: z.array(z.string().max(100)).max(30).default([]),
  customInstructions: z.string().max(4000).default(""),
  escalationKeywords: z.array(z.string().max(60)).max(100).default([]),
  escalateOnUncertainty: z.boolean().default(true),
  /** Sempre true — non disattivabile ("quando il cliente chiede una persona, la ottiene"). */
  escalateOnHumanRequest: z.literal(true).catch(true).default(true),
  maxAiTurns: z.number().int().min(3).max(20).default(8),
  historyMessages: z.number().int().min(5).max(50).default(20),
  welcomeMessageEnabled: z.boolean().default(true),
  handoffSummary: z.boolean().default(true),
  priceGuardrail: z.boolean().default(true),
});

export const dayScheduleSchema = z.object({
  enabled: z.boolean().default(true),
  start: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("09:00"),
  end: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("19:00"),
});
export type DaySchedule = z.infer<typeof dayScheduleSchema>;

const DEFAULT_DAY: DaySchedule = { enabled: true, start: "09:00", end: "19:00" };
const DEFAULT_WEEKEND: DaySchedule = { enabled: false, start: "09:00", end: "19:00" };

export const hoursSchema = z.object({
  timezone: z.string().max(60).default("Europe/Rome"),
  /** Indici 0 (domenica) → 6 (sabato), come Date#getDay. */
  schedule: z
    .array(dayScheduleSchema)
    .length(7)
    .default([
      { ...DEFAULT_WEEKEND }, // dom
      { ...DEFAULT_DAY }, // lun
      { ...DEFAULT_DAY }, // mar
      { ...DEFAULT_DAY }, // mer
      { ...DEFAULT_DAY }, // gio
      { ...DEFAULT_DAY }, // ven
      { ...DEFAULT_WEEKEND }, // sab
    ]),
  afterHoursMode: afterHoursModeSchema.default("ai_sempre"),
  afterHoursDisclaimer: z.boolean().default(true),
});

export const sendingSchema = z.object({
  sendProfile: sendProfileSchema.default("standard"),
  dailyCap: z.number().int().min(10).max(5000).default(1000),
  hourlyCap: z.number().int().min(5).max(1000).default(200),
  delayMinMs: z.number().int().min(1500).max(60000).default(3000),
  delayMaxMs: z.number().int().min(1500).max(60000).default(8000),
  replyOnlyMode: z.boolean().default(true),
  warmupMode: z.boolean().default(true),
  typingIndicator: z.boolean().default(true),
  randomDelay: z.boolean().default(true),
  businessHoursOnlyOutbound: z.boolean().default(true),
  /** Alto rischio ban — default sempre OFF. */
  groupAutoReply: z.boolean().default(false),
  pauseOnRisk: z.boolean().default(true),
});

export const inboxSchema = z.object({
  filterStatusBroadcast: z.boolean().default(true),
  filterNewsletter: z.boolean().default(true),
  filterGroups: groupFilterSchema.default("mostra_no_ai"),
  /** 0 = mai chiudere automaticamente. */
  autoCloseInactiveDays: z.number().int().min(0).max(365).default(0),
});

/** Avanzamento wizard /setup (persistito per riprendere il wizard). */
export const setupSchema = z.object({
  step: z.number().int().min(0).max(5).default(0),
  completed: z.boolean().default(false),
});

// ─── Root ────────────────────────────────────────────────────────────────────

export const tenantSettingsSchema = z.object({
  persona: personaSchema.default({}),
  behavior: behaviorSchema.default({}),
  hours: hoursSchema.default({}),
  sending: sendingSchema.default({}),
  inbox: inboxSchema.default({}),
  setup: setupSchema.default({}),
});

export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
export type PersonaSettings = z.infer<typeof personaSchema>;
export type BehaviorSettings = z.infer<typeof behaviorSchema>;
export type HoursSettings = z.infer<typeof hoursSchema>;
export type SendingSettings = z.infer<typeof sendingSchema>;
export type InboxSettings = z.infer<typeof inboxSchema>;
