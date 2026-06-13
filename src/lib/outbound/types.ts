/** Payload di un OutboundJob (colonna Json). Discriminato su `mode`. */
export type OutboundPayload =
  | { mode: "TEXT"; text: string }
  | { mode: "TEMPLATE"; templateId: string; vars: Record<string, string> }
  | { mode: "INTENT"; intent: string; context?: Record<string, unknown> };

/** Dati per decidere se un job può essere inviato ora (anti-ban). */
export interface SendGate {
  sessionStatus: string;            // WaSessionStatus
  optedIn: boolean;                 // IN o con almeno un IN in storico
  sentToday: number;
  dailyCap: number;
  sentThisHour: number;
  hourlyCap: number;
  lastSendAt: Date | null;          // ultimo OUT della sessione
  minSpacingMs: number;
  now: Date;
  businessHoursOnlyOutbound: boolean;
  withinHours: boolean;
  pauseOnRisk: boolean;
}

export interface SendDecision {
  ok: boolean;
  reason?: string;       // motivo dello skip (per audit/report)
  retryAfterMs?: number; // se è un blocco temporaneo (spacing/orari)
}
