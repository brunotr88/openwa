/**
 * recommendedDefaults — fonte unica della configurazione consigliata (M4).
 * Usata da: merge in getTenantSettings, RecommendedBadge, ResetToRecommended.
 *
 * Valori da docs/research/ai-strategies.md (tabella impostazioni) e
 * docs/research/whatsapp-ops.md (limiti/ritmi, flag operativi).
 */
import {
  tenantSettingsSchema,
  type ResponseStyle,
  type MaxResponseLength,
  type SendProfile,
  type TenantSettings,
} from "./schema";

// ─── Escalation keywords (ai-strategies.md, trigger table — verbatim) ────────

export const DEFAULT_ESCALATION_KEYWORDS: string[] = [
  // Richiesta esplicita di umano
  "operatore",
  "parlare con qualcuno",
  "una persona vera",
  "essere umano",
  "titolare",
  "responsabile",
  "non voglio parlare con un robot",
  // Reclamo / insoddisfazione
  "reclamo",
  "lamentela",
  "vergogna",
  "pessimo",
  "inaccettabile",
  "delusione",
  "mai più",
  "schifo",
  "truffa",
  // Minaccia legale
  "avvocato",
  "denuncia",
  "diffida",
  "vie legali",
  "carabinieri",
  "polizia postale",
  "associazione consumatori",
  "garante",
  // Denaro e rimborsi
  "rimborso",
  "risarcimento",
  "storno",
  "addebito errato",
  "pagato due volte",
  "soldi indietro",
  "contestazione",
  // Urgenza
  "urgente",
  "emergenza",
  "subito",
  "scadenza",
  "oggi stesso",
  "non funziona niente",
  "tutto fermo",
  "bloccato",
  // Disdetta / churn
  "disdire",
  "disdetta",
  "cancellare l'abbonamento",
  "recesso",
  "chiudere il contratto",
  "non rinnovo",
  // Dati sensibili / privacy
  "dati personali",
  "privacy",
  "gdpr",
  "cancellate i miei dati",
  "chi ha i miei dati",
];

export const DEFAULT_FORBIDDEN_TOPICS: string[] = [
  "concorrenti",
  "politica",
  "consigli medici",
  "consigli legali",
];

// ─── Stile risposta → temperatura / lunghezza → max token ───────────────────

export const RESPONSE_STYLE_TEMPERATURE: Record<ResponseStyle, number> = {
  preciso: 0.2,
  bilanciato: 0.4,
  creativo: 0.7,
};

/** Lunghezza target in caratteri (istruzione nel prompt). */
export const RESPONSE_LENGTH_CHARS: Record<MaxResponseLength, number> = {
  breve: 300,
  media: 600,
  lunga: 1000,
};

/** Tetto max_tokens corrispondente (con margine, ~3 char/token in italiano). */
export const RESPONSE_LENGTH_MAX_TOKENS: Record<MaxResponseLength, number> = {
  breve: 256,
  media: 512,
  lunga: 1024,
};

// ─── Profili di invio (whatsapp-ops.md, limiti e ritmi) ──────────────────────

export interface SendProfileValues {
  dailyCap: number;
  hourlyCap: number;
  delayMinMs: number;
  delayMaxMs: number;
}

/**
 * - prudente: numeri nuovi/in rodaggio — sotto la "safe zone" community (<30/h)
 * - standard (Consigliato): default tabella — 1.000/gg, 200/h, delay 3-8 s
 * - aggressivo: numero rodato con reply-rate >30% — range minimo 1,5 s
 */
export const SEND_PROFILES: Record<
  Exclude<SendProfile, "personalizzato">,
  SendProfileValues
> = {
  prudente: { dailyCap: 200, hourlyCap: 30, delayMinMs: 5000, delayMaxMs: 10000 },
  standard: { dailyCap: 1000, hourlyCap: 200, delayMinMs: 3000, delayMaxMs: 8000 },
  aggressivo: { dailyCap: 1500, hourlyCap: 300, delayMinMs: 1500, delayMaxMs: 4000 },
};

/** Applica i valori del profilo (no-op per "personalizzato"). */
export function applySendProfile(
  sending: TenantSettings["sending"],
  profile: SendProfile
): TenantSettings["sending"] {
  if (profile === "personalizzato") {
    return { ...sending, sendProfile: profile };
  }
  return { ...sending, sendProfile: profile, ...SEND_PROFILES[profile] };
}

// ─── Defaults consigliati (fonte unica) ──────────────────────────────────────

export const recommendedDefaults: TenantSettings = tenantSettingsSchema.parse({
  behavior: {
    escalationKeywords: DEFAULT_ESCALATION_KEYWORDS,
    forbiddenTopics: DEFAULT_FORBIDDEN_TOPICS,
  },
});
