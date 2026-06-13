# Fase 3 — Outbound + API privata + Campagne — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere a OpenWA una coda di invio in uscita (`OutboundJob` su Postgres) con throttling anti-ban, un'API privata per-tenant (`POST /api/v1/messages`, modi text/template/intent), un template store e campagne (invio a liste di contatti con scheduling e report).

**Architecture:** La coda vive su Postgres (no Redis — YAGNI). Un **worker** drena la coda tramite un endpoint interno `POST /api/internal/outbound/tick` (auth bearer `INTERNAL_GATEWAY_SECRET`) invocato da un **cron Coolify** ogni minuto — come gli esistenti `wa-keepalive`/`duckdns`. Il worker prende al più 1 job dovuto per sessione per tick: la cadenza del cron (≥60 s) impone da sola lo spacing anti-ban, in aggiunta a cap giornaliero/orario, gate opt-in e orari. Il gateway WhatsApp è di terze parti e non conosce la coda: il worker chiama `gateway.sendText`. Il `Message` in inbox viene creato **al momento dell'invio** (unica fonte di verità sul body, necessario per il modo INTENT in cui l'AI compone al volo).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Prisma 6 + Postgres, zod, Node `crypto` (SHA-256 + `timingSafeEqual` per le API key), Bedrock (modo intent), vitest (TDD sulle funzioni pure).

**Decisioni bloccate (dallo spec + scelte stack):**
- Coda Postgres drenata da cron→endpoint interno; ≤1 job/sessione/tick.
- API key: formato `owa_live_<base64url>`, in DB si salva solo `sha256(plaintext)` (unico) + `prefix` per display; plaintext mostrato una sola volta.
- Gate opt-in: si invia solo a contatti `optInStatus=IN` **o** con almeno un messaggio IN in storico. L'API può asserire il consenso (`optIn:true`) per numeri nuovi (l'app integrante è responsabile, registrato in audit).
- `Message` creato al send-time (deviazione consapevole dallo spec "Message(QUEUED) subito").
- Caps e spacing condivisi globalmente per sessione (API + campagne + auto-reply AI concorrono agli stessi limiti).

---

## File Structure

**Nuovi file:**
- `src/lib/outbound/types.ts` — tipi `OutboundPayload`, `SendGate`, `SendDecision`.
- `src/lib/outbound/pacing.ts` — funzioni pure: `isJobDue`, `evaluateSendEligibility`, `backoffDelayMs`.
- `src/lib/outbound/template.ts` — funzioni pure: `extractVariables`, `renderTemplate`.
- `src/lib/apikey.ts` — funzioni pure: `generateApiKey`, `hashApiKey`, `verifyApiKey`.
- `src/lib/api-auth.ts` — `authenticateApiKey(req)` (glue DB).
- `src/lib/outbound/enqueue.ts` — `enqueueOutbound`, `resolveSendableContact`, `pickSession` (glue DB).
- `src/lib/outbound/worker.ts` — `drainOutbound`, `sendOneJob` (glue DB+gateway+AI).
- `src/lib/outbound/campaign.ts` — `launchCampaign`, `campaignStats` (glue DB).
- `src/app/api/v1/messages/route.ts` — POST (API privata, invio).
- `src/app/api/v1/messages/[id]/route.ts` — GET (stato job).
- `src/app/api/internal/outbound/tick/route.ts` — POST (worker, auth interna).
- `src/app/api/apikeys/route.ts` + `src/app/api/apikeys/[id]/route.ts` — gestione key (NextAuth).
- `src/app/api/templates/route.ts` + `src/app/api/templates/[id]/route.ts` — CRUD template.
- `src/app/api/campaigns/route.ts` + `src/app/api/campaigns/[id]/route.ts` — campagne.
- `src/app/(app)/settings/sviluppatori/page.tsx` — UI API key + doc endpoint.
- `src/app/(app)/settings/conversazioni/template/page.tsx` — UI template.
- `src/app/(app)/campagne/page.tsx` + `src/app/(app)/campagne/[id]/page.tsx` — UI campagne.
- `tests/outbound/pacing.test.ts`, `tests/outbound/template.test.ts`, `tests/apikey.test.ts` — unit.
- `scripts/outbound-tick.sh` — script cron (riferimento per Coolify/server).

**File modificati:**
- `prisma/schema.prisma` — enum + model `OutboundJob`, `ApiKey`, `Template`, `Campaign` + relazioni inverse.
- `src/app/(app)/app-nav.tsx` — voce nav "Campagne".
- `src/app/(app)/settings/layout.tsx` (o il file che elenca le sezioni settings) — voci "Template" e "Sviluppatori".
- `.env.example` — placeholder per eventuali nuove env (nessuna nuova obbligatoria: si riusa `INTERNAL_GATEWAY_SECRET`).

> **Nota DB/migrazioni:** ogni `npx prisma migrate dev` va lanciato con `PRISMA_HIDE_UPDATE_MESSAGE=1` per evitare il box "Update available" che inquina l'SQL della migrazione (gotcha noto, vedi BLUEPRINT). In produzione Coolify applica `prisma migrate deploy` allo start.

---

## Milestone M3.1 — Schema dati & migrazione

### Task 1: Aggiungere enum + model alla schema Prisma

**Files:**
- Modify: `prisma/schema.prisma` (aggiungere enum dopo gli esistenti ~riga 83; model dopo `AuditLog` ~riga 261; relazioni inverse su `Tenant`, `Contact`, `Conversation`, `WaSession`, `Message`)

- [ ] **Step 1: Aggiungere gli enum** (dopo `AiProviderType`, prima della sezione "Core Tenant")

```prisma
enum OutboundMode {
  TEXT
  TEMPLATE
  INTENT
}

enum OutboundStatus {
  PENDING
  SENDING
  DONE
  FAILED
  CANCELED
}

enum CampaignStatus {
  DRAFT
  RUNNING
  PAUSED
  DONE
  CANCELED
}
```

- [ ] **Step 2: Aggiungere i model** (in fondo al file)

```prisma
// ─── Outbound queue (Fase 3) ────────────────────────────────────────────────

model ApiKey {
  id         String    @id @default(cuid())
  tenantId   String
  hashedKey  String    @unique          // sha256(plaintext) hex
  prefix     String                      // primi 12 char del plaintext, per display
  label      String
  scopes     String[]  @default([])      // es. ["messages:send"]
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())
  deletedAt  DateTime?

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId])
}

model Template {
  id        String    @id @default(cuid())
  tenantId  String
  name      String
  body      String                       // testo con {{placeholder}}
  variables String[]  @default([])        // nomi placeholder estratti
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  tenant    Tenant     @relation(fields: [tenantId], references: [id])
  campaigns Campaign[]

  @@unique([tenantId, name])
  @@index([tenantId])
}

model Campaign {
  id              String         @id @default(cuid())
  tenantId        String
  sessionId       String
  name            String
  mode            OutboundMode   @default(TEXT)
  body            String?                       // se TEXT
  templateId      String?                       // se TEMPLATE
  defaultVars     Json?                         // vars di campagna per il template
  status          CampaignStatus @default(DRAFT)
  scheduledAt     DateTime?
  totalRecipients Int            @default(0)
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
  deletedAt       DateTime?

  tenant   Tenant        @relation(fields: [tenantId], references: [id])
  session  WaSession     @relation(fields: [sessionId], references: [id])
  template Template?     @relation(fields: [templateId], references: [id])
  jobs     OutboundJob[]

  @@index([tenantId])
  @@index([status])
}

model OutboundJob {
  id             String         @id @default(cuid())
  tenantId       String
  sessionId      String
  contactId      String
  conversationId String?
  campaignId     String?
  mode           OutboundMode
  payload        Json                          // OutboundPayload (lib/outbound/types.ts)
  source         MessageSource  @default(API)
  status         OutboundStatus @default(PENDING)
  scheduledAt    DateTime?                      // null = appena possibile
  attempts       Int            @default(0)
  maxAttempts    Int            @default(3)
  lastError      String?
  messageId      String?                        // Message creato all'invio
  createdAt      DateTime       @default(now())
  sentAt         DateTime?

  tenant       Tenant        @relation(fields: [tenantId], references: [id])
  session      WaSession     @relation(fields: [sessionId], references: [id])
  contact      Contact       @relation(fields: [contactId], references: [id])
  conversation Conversation? @relation(fields: [conversationId], references: [id])
  campaign     Campaign?     @relation(fields: [campaignId], references: [id])

  @@index([status, scheduledAt])
  @@index([tenantId])
  @@index([sessionId, status])
  @@index([campaignId])
}
```

- [ ] **Step 3: Aggiungere le relazioni inverse** ai model esistenti

In `model Tenant { ... }` aggiungere alle relazioni:
```prisma
  apiKeys      ApiKey[]
  templates    Template[]
  campaigns    Campaign[]
  outboundJobs OutboundJob[]
```
In `model WaSession { ... }` (dopo `conversations Conversation[]`):
```prisma
  campaigns    Campaign[]
  outboundJobs OutboundJob[]
```
In `model Contact { ... }` (dopo `conversations Conversation[]`):
```prisma
  outboundJobs OutboundJob[]
```
In `model Conversation { ... }` (dopo `messages Message[]`):
```prisma
  outboundJobs OutboundJob[]
```

- [ ] **Step 4: Generare la migrazione e il client**

Run:
```bash
cd /mnt/c/PROGETTI/SOFTWARES/OpenWA
PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma migrate dev --name phase3_outbound --create-only
```
Aprire il file SQL generato in `prisma/migrations/*_phase3_outbound/migration.sql` e **verificare** che non contenga righe non-SQL (box "Update available"); se presenti, rimuoverle. Poi:
```bash
PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma generate
```
Expected: client rigenerato senza errori; nuovi tipi `OutboundJob`, `ApiKey`, `Template`, `Campaign` disponibili.

> Se è attivo un Postgres locale: `PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma migrate dev --name phase3_outbound` (senza `--create-only`) applica subito. In assenza di DB locale usare `--create-only` (sopra) e lasciare l'apply al deploy.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): Fase 3 schema — OutboundJob, ApiKey, Template, Campaign"
```

---

## Milestone M3.2 — API key (core + auth)

### Task 2: Funzioni pure API key (genera/hash/verifica) — TDD

**Files:**
- Create: `src/lib/apikey.ts`
- Test: `tests/apikey.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// tests/apikey.test.ts
import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, verifyApiKey } from "@/lib/apikey";

describe("apikey", () => {
  it("genera key con prefisso owa_live_ e hash coerente", () => {
    const k = generateApiKey();
    expect(k.plaintext).toMatch(/^owa_live_[A-Za-z0-9_-]{32,}$/);
    expect(k.prefix).toBe(k.plaintext.slice(0, 12));
    expect(k.hashedKey).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hashedKey).toBe(hashApiKey(k.plaintext));
  });

  it("genera key uniche", () => {
    expect(generateApiKey().plaintext).not.toBe(generateApiKey().plaintext);
  });

  it("verifyApiKey true solo per il plaintext corretto", () => {
    const k = generateApiKey();
    expect(verifyApiKey(k.plaintext, k.hashedKey)).toBe(true);
    expect(verifyApiKey("owa_live_sbagliata", k.hashedKey)).toBe(false);
  });

  it("verifyApiKey non lancia su lunghezze diverse", () => {
    const k = generateApiKey();
    expect(verifyApiKey("corta", k.hashedKey)).toBe(false);
  });
});
```

- [ ] **Step 2: Eseguire il test (deve fallire)**

Run: `npm test -- tests/apikey.test.ts`
Expected: FAIL — `Cannot find module '@/lib/apikey'`.

- [ ] **Step 3: Implementare**

```ts
// src/lib/apikey.ts
/**
 * API key per l'API privata (spec §10): si conserva solo lo SHA-256 del
 * plaintext (lookup per uguaglianza sull'hash di un segreto ad alta entropia)
 * + un prefisso per display. Confronto finale con timingSafeEqual.
 */
import { randomBytes, createHash, timingSafeEqual } from "crypto";

export interface GeneratedApiKey {
  plaintext: string; // mostrato UNA volta
  prefix: string;    // primi 12 char, salvati per display
  hashedKey: string; // sha256 hex, salvato e indicizzato
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(24).toString("base64url"); // 32 char url-safe
  const plaintext = `owa_live_${secret}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    hashedKey: hashApiKey(plaintext),
  };
}

export function verifyApiKey(plaintext: string, hashedKey: string): boolean {
  const a = Buffer.from(hashApiKey(plaintext), "hex");
  const b = Buffer.from(hashedKey, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Eseguire il test (deve passare)**

Run: `npm test -- tests/apikey.test.ts`
Expected: PASS (4 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/apikey.ts tests/apikey.test.ts
git commit -m "feat(api): apikey generate/hash/verify (timingSafeEqual)"
```

### Task 3: `authenticateApiKey` (glue DB)

**Files:**
- Create: `src/lib/api-auth.ts`

- [ ] **Step 1: Implementare**

```ts
// src/lib/api-auth.ts
/**
 * Auth per l'API privata /api/v1/*. Legge X-Api-Key, calcola lo SHA-256,
 * cerca la ApiKey attiva (deletedAt null) per hash, conferma con
 * timingSafeEqual (Task 2) e ritorna tenant/scope. Aggiorna lastUsedAt
 * fire-and-forget. Ritorna null su key assente/sconosciuta/revocata.
 */
import { db } from "@/lib/db";
import { hashApiKey, verifyApiKey } from "@/lib/apikey";

export interface ApiKeyActor {
  keyId: string;
  tenantId: string;
  scopes: string[];
}

export async function authenticateApiKey(req: Request): Promise<ApiKeyActor | null> {
  const presented = req.headers.get("x-api-key");
  if (!presented) return null;

  const record = await db.apiKey.findUnique({
    where: { hashedKey: hashApiKey(presented) },
  });
  if (!record || record.deletedAt) return null;
  if (!verifyApiKey(presented, record.hashedKey)) return null;

  void db.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { keyId: record.id, tenantId: record.tenantId, scopes: record.scopes };
}

export function hasScope(actor: ApiKeyActor, scope: string): boolean {
  return actor.scopes.includes(scope);
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore relativo a `api-auth.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/api-auth.ts
git commit -m "feat(api): authenticateApiKey middleware (X-Api-Key)"
```

---

## Milestone M3.3 — Coda outbound (logica pura + worker)

### Task 4: Tipi outbound

**Files:**
- Create: `src/lib/outbound/types.ts`

- [ ] **Step 1: Implementare**

```ts
// src/lib/outbound/types.ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/outbound/types.ts
git commit -m "feat(outbound): payload + send-gate types"
```

### Task 5: Pacing/eligibilità (funzioni pure) — TDD

**Files:**
- Create: `src/lib/outbound/pacing.ts`
- Test: `tests/outbound/pacing.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// tests/outbound/pacing.test.ts
import { describe, it, expect } from "vitest";
import { isJobDue, backoffDelayMs, evaluateSendEligibility } from "@/lib/outbound/pacing";
import type { SendGate } from "@/lib/outbound/types";

const base = (over: Partial<SendGate> = {}): SendGate => ({
  sessionStatus: "CONNECTED",
  optedIn: true,
  sentToday: 0,
  dailyCap: 1000,
  sentThisHour: 0,
  hourlyCap: 200,
  lastSendAt: null,
  minSpacingMs: 8000,
  now: new Date("2026-06-13T10:00:00Z"),
  businessHoursOnlyOutbound: true,
  withinHours: true,
  pauseOnRisk: true,
  ...over,
});

describe("isJobDue", () => {
  const now = new Date("2026-06-13T10:00:00Z");
  it("null scheduledAt è sempre dovuto", () => {
    expect(isJobDue(null, now)).toBe(true);
  });
  it("scheduledAt nel passato è dovuto", () => {
    expect(isJobDue(new Date("2026-06-13T09:59:00Z"), now)).toBe(true);
  });
  it("scheduledAt nel futuro non è dovuto", () => {
    expect(isJobDue(new Date("2026-06-13T10:01:00Z"), now)).toBe(false);
  });
});

describe("backoffDelayMs", () => {
  it("cresce esponenzialmente e si ferma a 1h", () => {
    expect(backoffDelayMs(1)).toBe(60_000);
    expect(backoffDelayMs(2)).toBe(120_000);
    expect(backoffDelayMs(3)).toBe(240_000);
    expect(backoffDelayMs(20)).toBe(3_600_000);
  });
});

describe("evaluateSendEligibility", () => {
  it("ok quando tutto è a posto", () => {
    expect(evaluateSendEligibility(base()).ok).toBe(true);
  });
  it("blocca se la sessione è BANNED e pauseOnRisk attivo", () => {
    const d = evaluateSendEligibility(base({ sessionStatus: "BANNED" }));
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("session_banned");
  });
  it("blocca se non opted-in", () => {
    expect(evaluateSendEligibility(base({ optedIn: false }))).toMatchObject({
      ok: false,
      reason: "not_opted_in",
    });
  });
  it("blocca al raggiungimento del cap giornaliero", () => {
    expect(evaluateSendEligibility(base({ sentToday: 1000, dailyCap: 1000 }))).toMatchObject({
      ok: false,
      reason: "daily_cap",
    });
  });
  it("blocca al cap orario con retryAfter", () => {
    const d = evaluateSendEligibility(base({ sentThisHour: 200, hourlyCap: 200 }));
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("hourly_cap");
    expect(d.retryAfterMs).toBeGreaterThan(0);
  });
  it("blocca se sotto lo spacing minimo dall'ultimo invio", () => {
    const d = evaluateSendEligibility(
      base({ lastSendAt: new Date("2026-06-13T09:59:57Z"), minSpacingMs: 8000 })
    );
    expect(d.ok).toBe(false);
    expect(d.reason).toBe("spacing");
    expect(d.retryAfterMs).toBe(5000);
  });
  it("blocca fuori orario se businessHoursOnlyOutbound", () => {
    expect(
      evaluateSendEligibility(base({ withinHours: false, businessHoursOnlyOutbound: true }))
    ).toMatchObject({ ok: false, reason: "outside_hours" });
  });
  it("consente fuori orario se businessHoursOnlyOutbound è off", () => {
    expect(
      evaluateSendEligibility(base({ withinHours: false, businessHoursOnlyOutbound: false })).ok
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Eseguire (deve fallire)**

Run: `npm test -- tests/outbound/pacing.test.ts`
Expected: FAIL — modulo non trovato.

- [ ] **Step 3: Implementare**

```ts
// src/lib/outbound/pacing.ts
/**
 * Logica anti-ban pura (spec §7). Nessun accesso a DB/rete: prende uno
 * stato (SendGate) e decide se inviare ora. Ordine dei gate: ban → opt-in →
 * cap giornaliero → cap orario → spacing → orari.
 */
import type { SendGate, SendDecision } from "./types";

export function isJobDue(scheduledAt: Date | null, now: Date): boolean {
  if (!scheduledAt) return true;
  return scheduledAt.getTime() <= now.getTime();
}

/** Backoff esponenziale: 2^(attempts-1) * 30s, cap 1h. */
export function backoffDelayMs(attempts: number): number {
  const ms = Math.pow(2, Math.max(0, attempts - 1)) * 30_000;
  return Math.min(ms, 3_600_000);
}

export function evaluateSendEligibility(g: SendGate): SendDecision {
  if (g.pauseOnRisk && g.sessionStatus === "BANNED") {
    return { ok: false, reason: "session_banned" };
  }
  if (g.sessionStatus !== "CONNECTED") {
    return { ok: false, reason: "session_offline", retryAfterMs: 60_000 };
  }
  if (!g.optedIn) {
    return { ok: false, reason: "not_opted_in" };
  }
  if (g.sentToday >= g.dailyCap) {
    return { ok: false, reason: "daily_cap" };
  }
  if (g.sentThisHour >= g.hourlyCap) {
    return { ok: false, reason: "hourly_cap", retryAfterMs: 5 * 60_000 };
  }
  if (g.lastSendAt) {
    const elapsed = g.now.getTime() - g.lastSendAt.getTime();
    if (elapsed < g.minSpacingMs) {
      return { ok: false, reason: "spacing", retryAfterMs: g.minSpacingMs - elapsed };
    }
  }
  if (g.businessHoursOnlyOutbound && !g.withinHours) {
    return { ok: false, reason: "outside_hours", retryAfterMs: 15 * 60_000 };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Eseguire (deve passare)**

Run: `npm test -- tests/outbound/pacing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outbound/pacing.ts tests/outbound/pacing.test.ts
git commit -m "feat(outbound): pure pacing/eligibility logic (anti-ban gates)"
```

### Task 6: Template render/extract (funzioni pure) — TDD

**Files:**
- Create: `src/lib/outbound/template.ts`
- Test: `tests/outbound/template.test.ts`

- [ ] **Step 1: Scrivere il test che fallisce**

```ts
// tests/outbound/template.test.ts
import { describe, it, expect } from "vitest";
import { extractVariables, renderTemplate } from "@/lib/outbound/template";

describe("extractVariables", () => {
  it("estrae nomi unici tra doppie graffe", () => {
    expect(extractVariables("Ciao {{nome}}, il tuo {{prodotto}} ({{nome}}) è pronto")).toEqual([
      "nome",
      "prodotto",
    ]);
  });
  it("tollera spazi interni", () => {
    expect(extractVariables("{{ nome }} e {{cognome}}")).toEqual(["nome", "cognome"]);
  });
  it("nessun placeholder → array vuoto", () => {
    expect(extractVariables("nessuna variabile")).toEqual([]);
  });
});

describe("renderTemplate", () => {
  it("sostituisce i placeholder noti", () => {
    expect(renderTemplate("Ciao {{nome}}", { nome: "Bruno" })).toBe("Ciao Bruno");
  });
  it("lancia se manca una variabile richiesta", () => {
    expect(() => renderTemplate("Ciao {{nome}}", {})).toThrow(/nome/);
  });
  it("sostituisce tutte le occorrenze", () => {
    expect(renderTemplate("{{x}}-{{x}}", { x: "a" })).toBe("a-a");
  });
});
```

- [ ] **Step 2: Eseguire (deve fallire)**

Run: `npm test -- tests/outbound/template.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementare**

```ts
// src/lib/outbound/template.ts
/** Template testuali con placeholder {{nome}}. Funzioni pure. */
const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) seen.add(m[1]);
  return [...seen];
}

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(VAR_RE, (_full, name: string) => {
    if (!(name in vars)) {
      throw new Error(`Variabile mancante nel template: ${name}`);
    }
    return vars[name];
  });
}
```

- [ ] **Step 4: Eseguire (deve passare)**

Run: `npm test -- tests/outbound/template.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/outbound/template.ts tests/outbound/template.test.ts
git commit -m "feat(outbound): pure template extract/render"
```

### Task 7: `enqueueOutbound` + helper contatto/sessione (glue DB)

**Files:**
- Create: `src/lib/outbound/enqueue.ts`

- [ ] **Step 1: Implementare**

```ts
// src/lib/outbound/enqueue.ts
/**
 * Inserimento job nella coda outbound. Risolve/crea il contatto destinatario
 * e la conversazione, sceglie la sessione del tenant, valida l'opt-in.
 * NON invia: il worker (Task 8) drena la coda.
 */
import { db } from "@/lib/db";
import type { OutboundPayload } from "./types";

/** Normalizza un numero in cifre senza prefisso "+"/suffissi. */
export function normalizePhone(input: string): string {
  return input.replace(/[^\d]/g, "");
}

/** Sessione CONNECTED del tenant (preferita) o la più recente. */
export async function pickSession(tenantId: string): Promise<{ id: string } | null> {
  const connected = await db.waSession.findFirst({
    where: { tenantId, deletedAt: null, status: "CONNECTED" },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (connected) return connected;
  return db.waSession.findFirst({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
}

export interface ResolvedContact {
  id: string;
  optedIn: boolean;
}

/**
 * Trova o crea un Contact per il numero. `assertOptIn=true` (l'app integrante
 * dichiara il consenso) imposta optInStatus=IN. `optedIn` finale = IN oppure
 * almeno un messaggio IN in storico.
 */
export async function resolveSendableContact(
  tenantId: string,
  to: string,
  assertOptIn: boolean
): Promise<ResolvedContact> {
  const phone = normalizePhone(to);
  const waId = phone; // chiave di matching: cifre, senza suffisso

  let contact = await db.contact.findUnique({
    where: { tenantId_waId: { tenantId, waId } },
    select: { id: true, optInStatus: true },
  });

  if (!contact) {
    contact = await db.contact.create({
      data: {
        tenantId,
        waId,
        phone,
        optInStatus: assertOptIn ? "IN" : "UNKNOWN",
      },
      select: { id: true, optInStatus: true },
    });
  } else if (assertOptIn && contact.optInStatus !== "IN") {
    contact = await db.contact.update({
      where: { id: contact.id },
      data: { optInStatus: "IN" },
      select: { id: true, optInStatus: true },
    });
  }

  let optedIn = contact.optInStatus === "IN";
  if (!optedIn) {
    const inbound = await db.message.count({
      where: { conversation: { contactId: contact.id }, direction: "IN" },
    });
    optedIn = inbound > 0;
  }
  return { id: contact.id, optedIn };
}

/** Conversazione aperta esistente per (contatto, sessione) o nuova. */
export async function ensureConversation(
  tenantId: string,
  contactId: string,
  sessionId: string
): Promise<string> {
  const existing = await db.conversation.findFirst({
    where: { tenantId, contactId, sessionId, deletedAt: null },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.conversation.create({
    data: { tenantId, contactId, sessionId, mode: "MANUAL", status: "OPEN" },
    select: { id: true },
  });
  return created.id;
}

export interface EnqueueParams {
  tenantId: string;
  sessionId: string;
  contactId: string;
  conversationId?: string;
  mode: "TEXT" | "TEMPLATE" | "INTENT";
  payload: OutboundPayload;
  source?: "API" | "CAMPAIGN";
  scheduledAt?: Date | null;
  campaignId?: string;
}

export async function enqueueOutbound(p: EnqueueParams): Promise<string> {
  const job = await db.outboundJob.create({
    data: {
      tenantId: p.tenantId,
      sessionId: p.sessionId,
      contactId: p.contactId,
      conversationId: p.conversationId ?? null,
      campaignId: p.campaignId ?? null,
      mode: p.mode,
      payload: p.payload as object,
      source: p.source ?? "API",
      scheduledAt: p.scheduledAt ?? null,
      status: "PENDING",
    },
    select: { id: true },
  });
  return job.id;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore in `enqueue.ts` (i nomi relazione `tenantId_waId` provengono da `@@unique([tenantId, waId])`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/outbound/enqueue.ts
git commit -m "feat(outbound): enqueue + contact/session/conversation resolution"
```

### Task 8: Worker `drainOutbound`/`sendOneJob` (glue DB+gateway+AI)

**Files:**
- Create: `src/lib/outbound/worker.ts`

- [ ] **Step 1: Implementare**

```ts
// src/lib/outbound/worker.ts
/**
 * Worker della coda outbound. Invocato dall'endpoint interno /tick (cron).
 * Per ogni sessione con job dovuti prende al più `maxPerSessionPerTick` job
 * (default 1): la cadenza del cron impone lo spacing. Valuta i gate anti-ban
 * (pacing.ts), risolve il body (text/template/intent), invia via gateway,
 * crea il Message in inbox e aggiorna il job.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { sendText } from "@/lib/wa/gateway-client";
import { getProvider } from "@/lib/ai";
import {
  getTenantSettings,
  buildSystemPrompt,
  isWithinSchedule,
  styleTemperature,
  lengthMaxTokens,
} from "@/lib/settings";
import { renderTemplate } from "./template";
import { evaluateSendEligibility, isJobDue, backoffDelayMs } from "./pacing";
import type { OutboundPayload } from "./types";

const MAX_PER_SESSION_PER_TICK = 1;

export interface DrainSummary {
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}

export async function drainOutbound(now: Date = new Date()): Promise<DrainSummary> {
  const summary: DrainSummary = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  // Sessioni con almeno un job dovuto.
  const dueJobs = await db.outboundJob.findMany({
    where: {
      status: "PENDING",
      OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }],
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, sessionId: true },
  });
  const bySession = new Map<string, string[]>();
  for (const j of dueJobs) {
    if (!isJobDue(null, now)) continue;
    const arr = bySession.get(j.sessionId) ?? [];
    if (arr.length < MAX_PER_SESSION_PER_TICK) arr.push(j.id);
    bySession.set(j.sessionId, arr);
  }

  for (const [, jobIds] of bySession) {
    for (const jobId of jobIds) {
      summary.processed++;
      const res = await sendOneJob(jobId, now);
      summary[res]++;
    }
  }
  return summary;
}

type JobOutcome = "sent" | "failed" | "skipped";

export async function sendOneJob(jobId: string, now: Date): Promise<JobOutcome> {
  // Lock ottimistico: PENDING → SENDING solo se ancora PENDING.
  const lock = await db.outboundJob.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: { status: "SENDING" },
  });
  if (lock.count === 0) return "skipped";

  const job = await db.outboundJob.findUnique({
    where: { id: jobId },
    include: { session: true, contact: true },
  });
  if (!job) return "skipped";

  const settings = await getTenantSettings(job.tenantId);

  // Stato anti-ban della sessione.
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const startOfHour = new Date(now);
  startOfHour.setMinutes(0, 0, 0);
  const [sentToday, sentThisHour, lastOut] = await Promise.all([
    db.message.count({
      where: {
        tenantId: job.tenantId,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfDay },
      },
    }),
    db.message.count({
      where: {
        tenantId: job.tenantId,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfHour },
      },
    }),
    db.message.findFirst({
      where: {
        tenantId: job.tenantId,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  // opt-in: IN o almeno un IN in storico.
  const inbound = await db.message.count({
    where: { conversation: { contactId: job.contactId }, direction: "IN" },
  });
  const optedIn = job.contact.optInStatus === "IN" || inbound > 0;

  const decision = evaluateSendEligibility({
    sessionStatus: job.session.status,
    optedIn,
    sentToday,
    dailyCap: settings.sending.dailyCap,
    sentThisHour,
    hourlyCap: settings.sending.hourlyCap,
    lastSendAt: lastOut?.createdAt ?? null,
    minSpacingMs: settings.sending.delayMinMs,
    now,
    businessHoursOnlyOutbound: settings.sending.businessHoursOnlyOutbound,
    withinHours: isWithinSchedule(settings.hours, now),
    pauseOnRisk: settings.sending.pauseOnRisk,
  });

  if (!decision.ok) {
    // Blocco temporaneo → riprogramma; blocco definitivo → FAILED.
    if (decision.retryAfterMs) {
      await db.outboundJob.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          scheduledAt: new Date(now.getTime() + decision.retryAfterMs),
          lastError: decision.reason,
        },
      });
    } else {
      await db.outboundJob.update({
        where: { id: job.id },
        data: { status: "FAILED", lastError: decision.reason },
      });
      await auditLog({
        tenantId: job.tenantId,
        action: "outbound.skipped",
        entity: "OutboundJob",
        entityId: job.id,
        meta: { reason: decision.reason, contactId: job.contactId },
      });
    }
    return "skipped";
  }

  // Risoluzione body.
  let body: string;
  try {
    body = await resolveBody(job, settings);
  } catch (e) {
    return await markFailed(job.id, job.tenantId, job.attempts, job.maxAttempts, now, e);
  }
  if (!body.trim()) {
    return await markFailed(job.id, job.tenantId, job.attempts, job.maxAttempts, now, new Error("empty body"));
  }

  const conversationId =
    job.conversationId ??
    (await (async () => {
      const { ensureConversation } = await import("./enqueue");
      return ensureConversation(job.tenantId, job.contactId, job.sessionId);
    })());

  // Invio.
  try {
    const gwId = job.session.sessionDataRef;
    if (!gwId) throw new Error("session has no gateway ref");
    await sendText(gwId, job.contact.phone ?? job.contact.waId, body);

    const message = await db.message.create({
      data: {
        conversationId,
        tenantId: job.tenantId,
        direction: "OUT",
        body,
        status: "SENT",
        aiGenerated: job.mode === "INTENT",
        source: job.source,
      },
      select: { id: true },
    });
    await db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: now },
    });
    await db.outboundJob.update({
      where: { id: job.id },
      data: { status: "DONE", sentAt: now, messageId: message.id, conversationId },
    });
    await auditLog({
      tenantId: job.tenantId,
      action: "outbound.sent",
      entity: "OutboundJob",
      entityId: job.id,
      meta: { contactId: job.contactId, source: job.source, campaignId: job.campaignId },
    });
    return "sent";
  } catch (e) {
    return await markFailed(job.id, job.tenantId, job.attempts, job.maxAttempts, now, e);
  }
}

async function resolveBody(
  job: { mode: string; payload: unknown; tenantId: string; contact: { name: string | null; profileSummary: string | null } },
  settings: Awaited<ReturnType<typeof getTenantSettings>>
): Promise<string> {
  const payload = job.payload as OutboundPayload;
  if (payload.mode === "TEXT") return payload.text;

  if (payload.mode === "TEMPLATE") {
    const tpl = await db.template.findFirst({
      where: { id: payload.templateId, tenantId: job.tenantId, deletedAt: null },
      select: { body: true },
    });
    if (!tpl) throw new Error(`template ${payload.templateId} not found`);
    const vars: Record<string, string> = {
      nome: job.contact.name ?? "",
      ...payload.vars,
    };
    return renderTemplate(tpl.body, vars);
  }

  // INTENT: l'AI compone col tono brand + memoria contatto.
  const aiConfig = await db.aiConfig.findUnique({ where: { tenantId: job.tenantId } });
  if (!aiConfig) throw new Error("no AiConfig for intent compose");
  const system = buildSystemPrompt(settings, {
    contactSummary: [
      job.contact.name ? `Stai scrivendo a: ${job.contact.name}.` : null,
      job.contact.profileSummary,
    ]
      .filter(Boolean)
      .join("\n"),
    outsideBusinessHours: false,
  });
  const ctx = payload.context ? `\nContesto: ${JSON.stringify(payload.context)}` : "";
  const provider = getProvider({ provider: aiConfig.provider });
  const result = await provider.generate({
    system: `${system}\n\nComponi un singolo messaggio WhatsApp in uscita (no preamboli).`,
    messages: [{ role: "user", content: `Intento: ${payload.intent}${ctx}` }],
    modelId: aiConfig.modelId,
    temperature: styleTemperature(settings.behavior.responseStyle),
    maxTokens: lengthMaxTokens(settings.behavior.maxResponseLength),
  });
  return result.text.trim();
}

async function markFailed(
  jobId: string,
  tenantId: string,
  attempts: number,
  maxAttempts: number,
  now: Date,
  e: unknown
): Promise<JobOutcome> {
  const nextAttempts = attempts + 1;
  const error = e instanceof Error ? e.message : String(e);
  if (nextAttempts >= maxAttempts) {
    await db.outboundJob.update({
      where: { id: jobId },
      data: { status: "FAILED", attempts: nextAttempts, lastError: error },
    });
    await auditLog({
      tenantId,
      action: "outbound.failed",
      entity: "OutboundJob",
      entityId: jobId,
      meta: { error, attempts: nextAttempts },
    });
    return "failed";
  }
  await db.outboundJob.update({
    where: { id: jobId },
    data: {
      status: "PENDING",
      attempts: nextAttempts,
      lastError: error,
      scheduledAt: new Date(now.getTime() + backoffDelayMs(nextAttempts)),
    },
  });
  return "failed";
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore. Verificare che `provider.generate` accetti la forma usata (vedi `src/lib/ai/provider.ts`: `GenerateInput` con `system`, `messages`, `modelId`, `temperature`, `maxTokens`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/outbound/worker.ts
git commit -m "feat(outbound): worker drain + sendOneJob (text/template/intent)"
```

### Task 9: Endpoint interno tick (cron)

**Files:**
- Create: `src/app/api/internal/outbound/tick/route.ts`

- [ ] **Step 1: Implementare**

```ts
// src/app/api/internal/outbound/tick/route.ts
/**
 * Worker tick — invocato dal cron Coolify ogni minuto.
 * Auth: Authorization: Bearer <INTERNAL_GATEWAY_SECRET>, confronto
 * timingSafeEqual. Drena la coda (al più 1 job/sessione) e ritorna il riepilogo.
 */
import { timingSafeEqual } from "crypto";
import { drainOutbound } from "@/lib/outbound/worker";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.INTERNAL_GATEWAY_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const presented = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const summary = await drainOutbound(new Date());
  return Response.json({ ok: true, ...summary });
}
```

- [ ] **Step 2: Typecheck + build parziale**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/internal/outbound/tick/route.ts
git commit -m "feat(outbound): internal tick endpoint (cron-driven worker)"
```

### Task 10: Script cron di riferimento

**Files:**
- Create: `scripts/outbound-tick.sh`

- [ ] **Step 1: Implementare**

```bash
#!/usr/bin/env bash
# Cron worker outbound — esegue un tick della coda ogni minuto.
# Installazione (sul server, come per wa-keepalive):
#   * * * * * INTERNAL_GATEWAY_SECRET=<secret> /usr/local/bin/outbound-tick.sh
# In Coolify: Scheduled Task, comando:
#   curl -fsS -X POST http://openwa-web:3000/api/internal/outbound/tick \
#        -H "Authorization: Bearer $INTERNAL_GATEWAY_SECRET"  (frequenza: * * * * *)
set -euo pipefail
URL="${OUTBOUND_TICK_URL:-http://openwa-web:3000/api/internal/outbound/tick}"
curl -fsS -m 50 -X POST "$URL" \
  -H "Authorization: Bearer ${INTERNAL_GATEWAY_SECRET:?manca INTERNAL_GATEWAY_SECRET}" \
  >/dev/null
```

- [ ] **Step 2: Commit**

```bash
git add scripts/outbound-tick.sh
git commit -m "chore(outbound): cron tick reference script"
```

---

## Milestone M3.4 — API privata (invio + stato)

### Task 11: `POST /api/v1/messages`

**Files:**
- Create: `src/app/api/v1/messages/route.ts`

- [ ] **Step 1: Implementare**

```ts
// src/app/api/v1/messages/route.ts
/**
 * API privata — accetta una richiesta di invio e la mette in coda.
 * Auth: header X-Api-Key (scope "messages:send"). Modi: text/template/intent.
 * Risposta 202 { jobId }. Gate opt-in: solo contatti IN o che hanno scritto;
 * `optIn:true` dichiara il consenso per numeri nuovi (registrato in audit).
 */
import { z } from "zod";
import { auditLog } from "@/lib/audit";
import { authenticateApiKey, hasScope } from "@/lib/api-auth";
import {
  enqueueOutbound,
  pickSession,
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
    scheduledAt: z.string().datetime().optional(),
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

  const session = await pickSession(actor.tenantId);
  if (!session) return Response.json({ error: "no whatsapp session" }, { status: 409 });

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
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/messages/route.ts
git commit -m "feat(api): POST /api/v1/messages (enqueue text/template/intent)"
```

### Task 12: `GET /api/v1/messages/[id]` (stato job)

**Files:**
- Create: `src/app/api/v1/messages/[id]/route.ts`

- [ ] **Step 1: Implementare**

```ts
// src/app/api/v1/messages/[id]/route.ts
/** Stato di un OutboundJob (delivery feedback per le app integranti). */
import { db } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await authenticateApiKey(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const job = await db.outboundJob.findFirst({
    where: { id, tenantId: actor.tenantId }, // IDOR: scoping per tenant della key
    select: {
      id: true,
      status: true,
      mode: true,
      attempts: true,
      lastError: true,
      messageId: true,
      scheduledAt: true,
      sentAt: true,
      createdAt: true,
    },
  });
  if (!job) return Response.json({ error: "not_found" }, { status: 404 });

  let messageStatus: string | null = null;
  if (job.messageId) {
    const m = await db.message.findUnique({
      where: { id: job.messageId },
      select: { status: true },
    });
    messageStatus = m?.status ?? null;
  }
  return Response.json({ ...job, messageStatus });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/messages/[id]/route.ts
git commit -m "feat(api): GET /api/v1/messages/:id (job status)"
```

---

## Milestone M3.5 — Gestione API key (route + UI)

### Task 13: Route gestione API key

**Files:**
- Create: `src/app/api/apikeys/route.ts`
- Create: `src/app/api/apikeys/[id]/route.ts`

- [ ] **Step 1: Implementare `route.ts` (GET lista, POST crea)**

```ts
// src/app/api/apikeys/route.ts
/**
 * Gestione API key (NextAuth, tenant-scoped). POST ritorna il plaintext UNA
 * sola volta. La lista mostra solo prefix + metadati.
 */
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId } from "@/lib/authz";
import { generateApiKey } from "@/lib/apikey";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = await resolveTenantId(actor, new URL(req.url).searchParams.get("tenantId"));
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const keys = await db.apiKey.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, prefix: true, label: true, scopes: true, lastUsedAt: true, createdAt: true },
  });
  return Response.json({ keys });
}

const createSchema = z.object({
  tenantId: z.string().optional(),
  label: z.string().min(1).max(80),
  scopes: z.array(z.string()).default(["messages:send"]),
});

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const tenantId = await resolveTenantId(actor, parsed.data.tenantId ?? null);
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const generated = generateApiKey();
  const created = await db.apiKey.create({
    data: {
      tenantId,
      hashedKey: generated.hashedKey,
      prefix: generated.prefix,
      label: parsed.data.label,
      scopes: parsed.data.scopes,
    },
    select: { id: true, prefix: true, label: true, scopes: true, createdAt: true },
  });

  await auditLog({
    userId: actor.userId,
    tenantId,
    action: "apikey.create",
    entity: "ApiKey",
    entityId: created.id,
    meta: { label: created.label, scopes: created.scopes },
  });

  // plaintext mostrato solo qui, mai più recuperabile.
  return Response.json({ key: created, plaintext: generated.plaintext }, { status: 201 });
}
```

- [ ] **Step 2: Implementare `[id]/route.ts` (DELETE = revoca soft)**

```ts
// src/app/api/apikeys/[id]/route.ts
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const key = await db.apiKey.findUnique({ where: { id }, select: { id: true, tenantId: true } });
  if (!key || !canAccessTenant(actor, key.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await db.apiKey.update({ where: { id }, data: { deletedAt: new Date() } });
  await auditLog({
    userId: actor.userId,
    tenantId: key.tenantId,
    action: "apikey.revoke",
    entity: "ApiKey",
    entityId: id,
  });
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/apikeys
git commit -m "feat(api): API key management routes (list/create/revoke)"
```

### Task 14: UI Sviluppatori (API key + doc endpoint)

**Files:**
- Create: `src/app/(app)/settings/sviluppatori/page.tsx`
- Modify: `src/app/(app)/settings/layout.tsx` (aggiungere la voce "Sviluppatori" alla nav settings — adattare ai pattern del file: cercare l'array di sezioni e aggiungere `{ href: "/settings/sviluppatori", label: "Sviluppatori" }`)

- [ ] **Step 1: Implementare la pagina**

```tsx
// src/app/(app)/settings/sviluppatori/page.tsx
"use client";

/**
 * Settings → Sviluppatori: gestione API key per l'API privata + esempi d'uso.
 * Il plaintext della key appena creata è mostrato una sola volta in un banner.
 */
import { useEffect, useState } from "react";
import { Copy, KeyRound, Trash2, Check } from "lucide-react";
import { SettingsCard } from "@/components/settings/setting-row";

interface ApiKeyRow {
  id: string;
  prefix: string;
  label: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

export default function SviluppatoriPage() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    const r = await fetch("/api/apikeys");
    if (r.ok) setKeys((await r.json()).keys);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!label.trim()) return;
    setLoading(true);
    const r = await fetch("/api/apikeys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), scopes: ["messages:send"] }),
    });
    setLoading(false);
    if (r.ok) {
      const data = await r.json();
      setCreated(data.plaintext);
      setLabel("");
      void load();
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revocare questa API key? Le app che la usano smetteranno di funzionare.")) return;
    await fetch(`/api/apikeys/${id}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="API key"
        description="Chiavi per l'API privata di invio (header X-Api-Key). Conserva la chiave: è mostrata una sola volta."
      >
        {created && (
          <div className="mb-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-sm font-medium text-ink">Nuova chiave creata — copiala ora</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded-lg bg-surface px-3 py-2 text-xs">{created}</code>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(created);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs hover:bg-muted"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copiata" : "Copia"}
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Etichetta (es. CRM interno)"
            className="flex-1 rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
          />
          <button
            type="button"
            onClick={create}
            disabled={loading || !label.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <KeyRound size={16} />
            Crea key
          </button>
        </div>

        <ul className="mt-4 divide-y divide-border">
          {keys.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">Nessuna API key.</li>
          )}
          {keys.map((k) => (
            <li key={k.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{k.label}</p>
                <p className="truncate text-xs text-muted-foreground">
                  <code>{k.prefix}…</code> · {k.scopes.join(", ")} ·{" "}
                  {k.lastUsedAt ? `usata ${new Date(k.lastUsedAt).toLocaleDateString("it-IT")}` : "mai usata"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(k.id)}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
                Revoca
              </button>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard title="Come si usa" description="Esempio di invio dalla tua applicazione.">
        <pre className="overflow-x-auto rounded-xl bg-ink/95 p-4 text-xs text-white">
{`curl -X POST https://openwa.isipc.com/api/v1/messages \\
  -H "X-Api-Key: owa_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+39333...",
    "mode": "text",
    "text": "Ciao, il tuo ordine è pronto",
    "optIn": true
  }'`}
        </pre>
        <p className="mt-2 text-xs text-muted-foreground">
          Modi: <code>text</code>, <code>template</code> (templateId + vars), <code>intent</code> (l&apos;AI
          compone). Risposta <code>202 {"{ jobId }"}</code>. Stato: <code>GET /api/v1/messages/&lt;jobId&gt;</code>.
        </p>
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 2: Verifica build**

Run: `npm run build`
Expected: build OK, nuova rotta `/settings/sviluppatori` presente nell'output. Se `SettingsCard` ha props diverse (`title`/`description`), adattare alla firma reale (vedi `src/components/settings/setting-row.tsx`).

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/sviluppatori/page.tsx" "src/app/(app)/settings/layout.tsx"
git commit -m "feat(ui): pagina Sviluppatori (API key + doc endpoint)"
```

---

## Milestone M3.6 — Template (route + UI)

### Task 15: Route CRUD template

**Files:**
- Create: `src/app/api/templates/route.ts`
- Create: `src/app/api/templates/[id]/route.ts`

- [ ] **Step 1: Implementare `route.ts` (GET, POST)**

```ts
// src/app/api/templates/route.ts
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, resolveTenantId } from "@/lib/authz";
import { extractVariables } from "@/lib/outbound/template";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = await resolveTenantId(actor, new URL(req.url).searchParams.get("tenantId"));
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const templates = await db.template.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, body: true, variables: true, updatedAt: true },
  });
  return Response.json({ templates });
}

const upsertSchema = z.object({
  tenantId: z.string().optional(),
  name: z.string().min(1).max(80),
  body: z.string().min(1).max(4096),
});

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = upsertSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const tenantId = await resolveTenantId(actor, parsed.data.tenantId ?? null);
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const variables = extractVariables(parsed.data.body);
  try {
    const tpl = await db.template.create({
      data: { tenantId, name: parsed.data.name, body: parsed.data.body, variables },
      select: { id: true, name: true, body: true, variables: true, updatedAt: true },
    });
    await auditLog({
      userId: actor.userId,
      tenantId,
      action: "template.create",
      entity: "Template",
      entityId: tpl.id,
      meta: { name: tpl.name },
    });
    return Response.json({ template: tpl }, { status: 201 });
  } catch {
    return Response.json({ error: "nome già esistente" }, { status: 409 });
  }
}
```

- [ ] **Step 2: Implementare `[id]/route.ts` (PUT, DELETE)**

```ts
// src/app/api/templates/[id]/route.ts
import { z } from "zod";
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { extractVariables } from "@/lib/outbound/template";

export const dynamic = "force-dynamic";

const putSchema = z.object({ name: z.string().min(1).max(80), body: z.string().min(1).max(4096) });

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const tpl = await db.template.findUnique({ where: { id }, select: { tenantId: true } });
  if (!tpl || !canAccessTenant(actor, tpl.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });

  const updated = await db.template.update({
    where: { id },
    data: {
      name: parsed.data.name,
      body: parsed.data.body,
      variables: extractVariables(parsed.data.body),
    },
    select: { id: true, name: true, body: true, variables: true, updatedAt: true },
  });
  await auditLog({
    userId: actor.userId,
    tenantId: tpl.tenantId,
    action: "template.update",
    entity: "Template",
    entityId: id,
  });
  return Response.json({ template: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const tpl = await db.template.findUnique({ where: { id }, select: { tenantId: true } });
  if (!tpl || !canAccessTenant(actor, tpl.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  await db.template.update({ where: { id }, data: { deletedAt: new Date() } });
  await auditLog({
    userId: actor.userId,
    tenantId: tpl.tenantId,
    action: "template.delete",
    entity: "Template",
    entityId: id,
  });
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/templates
git commit -m "feat(api): template CRUD routes"
```

### Task 16: UI Template

**Files:**
- Create: `src/app/(app)/settings/conversazioni/template/page.tsx`
- Modify: nav settings conversazioni (aggiungere voce "Template" se la sezione conversazioni ha una sotto-nav; altrimenti la pagina è raggiungibile direttamente)

- [ ] **Step 1: Implementare la pagina**

```tsx
// src/app/(app)/settings/conversazioni/template/page.tsx
"use client";

/**
 * Settings → Conversazioni → Template: editor di template testuali con
 * placeholder {{nome}}. I template alimentano API (mode=template) e campagne.
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, Save } from "lucide-react";
import { SettingsCard } from "@/components/settings/setting-row";
import { extractVariables } from "@/lib/outbound/template";

interface Tpl {
  id: string;
  name: string;
  body: string;
  variables: string[];
  updatedAt: string;
}

export default function TemplatePage() {
  const [list, setList] = useState<Tpl[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");

  async function load() {
    const r = await fetch("/api/templates");
    if (r.ok) setList((await r.json()).templates);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!name.trim() || !body.trim()) return;
    const r = await fetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), body }),
    });
    if (r.ok) {
      setName("");
      setBody("");
      void load();
    } else {
      alert((await r.json()).error ?? "errore");
    }
  }

  async function remove(id: string) {
    if (!confirm("Eliminare il template?")) return;
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    void load();
  }

  const previewVars = extractVariables(body);

  return (
    <div className="space-y-6">
      <SettingsCard title="Nuovo template" description="Usa {{nome}} per i campi dinamici. {{nome}} è compilato dal contatto.">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome template (es. promemoria-ritiro)"
          className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          placeholder="Ciao {{nome}}, il tuo {{prodotto}} è pronto per il ritiro."
          className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm focus:border-primary/50 md:text-sm"
        />
        {previewVars.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Variabili: {previewVars.map((v) => <code key={v} className="mr-1">{`{{${v}}}`}</code>)}
          </p>
        )}
        <button
          type="button"
          onClick={create}
          disabled={!name.trim() || !body.trim()}
          className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Plus size={16} />
          Crea template
        </button>
      </SettingsCard>

      <SettingsCard title="Template salvati">
        <ul className="divide-y divide-border">
          {list.length === 0 && (
            <li className="py-6 text-center text-sm text-muted-foreground">Nessun template.</li>
          )}
          {list.map((t) => (
            <li key={t.id} className="py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{t.name}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted-foreground">{t.body}</p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="shrink-0 rounded-lg border border-border p-2 text-red-600 hover:bg-red-50"
                  aria-label="Elimina"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
}
```

- [ ] **Step 2: Verifica build**

Run: `npm run build`
Expected: build OK; rotta `/settings/conversazioni/template` presente. Verificare la firma reale di `SettingsCard`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/settings/conversazioni/template/page.tsx"
git commit -m "feat(ui): editor template (placeholder {{nome}})"
```

---

## Milestone M3.7 — Campagne (logica + route + UI)

### Task 17: `launchCampaign` + `campaignStats` (glue DB)

**Files:**
- Create: `src/lib/outbound/campaign.ts`

- [ ] **Step 1: Implementare**

```ts
// src/lib/outbound/campaign.ts
/**
 * Lancio campagna: enumera i destinatari eleggibili (opt-in IN o con storico
 * IN, filtrabili per tag) e crea un OutboundJob per ciascuno con campaignId.
 * Il pacing/anti-ban è gestito dal worker (al più 1 invio/sessione/tick), così
 * una campagna di N contatti viene spalmata nel tempo in modo sicuro.
 */
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { enqueueOutbound, ensureConversation } from "./enqueue";
import type { OutboundPayload } from "./types";

export interface LaunchResult {
  enqueued: number;
  skipped: number;
}

/** Contatti del tenant eleggibili all'invio (opt-in o con almeno un IN). */
async function eligibleContacts(tenantId: string, tags: string[]): Promise<{ id: string; name: string | null }[]> {
  const contacts = await db.contact.findMany({
    where: {
      tenantId,
      deletedAt: null,
      ...(tags.length > 0 ? { tags: { hasSome: tags } } : {}),
    },
    select: { id: true, name: true, optInStatus: true },
  });
  const result: { id: string; name: string | null }[] = [];
  for (const c of contacts) {
    if (c.optInStatus === "IN") {
      result.push({ id: c.id, name: c.name });
      continue;
    }
    const inbound = await db.message.count({
      where: { conversation: { contactId: c.id }, direction: "IN" },
    });
    if (inbound > 0) result.push({ id: c.id, name: c.name });
  }
  return result;
}

export async function launchCampaign(campaignId: string): Promise<LaunchResult> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("campaign not found");
  if (campaign.status !== "DRAFT") throw new Error(`campaign already ${campaign.status}`);

  const tags = Array.isArray((campaign.defaultVars as { tags?: string[] } | null)?.tags)
    ? ((campaign.defaultVars as { tags?: string[] }).tags as string[])
    : [];
  const recipients = await eligibleContacts(campaign.tenantId, tags);

  let enqueued = 0;
  for (const c of recipients) {
    const conversationId = await ensureConversation(campaign.tenantId, c.id, campaign.sessionId);
    const payload: OutboundPayload =
      campaign.mode === "TEMPLATE" && campaign.templateId
        ? {
            mode: "TEMPLATE",
            templateId: campaign.templateId,
            vars: { nome: c.name ?? "", ...((campaign.defaultVars as Record<string, string>) ?? {}) },
          }
        : { mode: "TEXT", text: campaign.body ?? "" };

    await enqueueOutbound({
      tenantId: campaign.tenantId,
      sessionId: campaign.sessionId,
      contactId: c.id,
      conversationId,
      mode: campaign.mode === "TEMPLATE" ? "TEMPLATE" : "TEXT",
      payload,
      source: "CAMPAIGN",
      campaignId: campaign.id,
      scheduledAt: campaign.scheduledAt ?? null,
    });
    enqueued++;
  }

  await db.campaign.update({
    where: { id: campaign.id },
    data: { status: "RUNNING", totalRecipients: enqueued },
  });
  await auditLog({
    tenantId: campaign.tenantId,
    action: "campaign.launch",
    entity: "Campaign",
    entityId: campaign.id,
    meta: { enqueued, tags },
  });
  return { enqueued, skipped: 0 };
}

export interface CampaignStats {
  total: number;
  pending: number;
  sent: number;
  failed: number;
}

export async function campaignStats(campaignId: string): Promise<CampaignStats> {
  const groups = await db.outboundJob.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });
  const get = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  const sent = get("DONE");
  const failed = get("FAILED") + get("CANCELED");
  const pending = get("PENDING") + get("SENDING");
  return { total: sent + failed + pending, pending, sent, failed };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 3: Commit**

```bash
git add src/lib/outbound/campaign.ts
git commit -m "feat(outbound): launchCampaign + campaignStats"
```

### Task 18: Route campagne

**Files:**
- Create: `src/app/api/campaigns/route.ts`
- Create: `src/app/api/campaigns/[id]/route.ts`

- [ ] **Step 1: Implementare `route.ts` (GET lista, POST crea+lancia)**

```ts
// src/app/api/campaigns/route.ts
import { z } from "zod";
import { db } from "@/lib/db";
import { getActor, resolveTenantId } from "@/lib/authz";
import { pickSession } from "@/lib/outbound/enqueue";
import { launchCampaign, campaignStats } from "@/lib/outbound/campaign";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const tenantId = await resolveTenantId(actor, new URL(req.url).searchParams.get("tenantId"));
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const campaigns = await db.campaign.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      mode: true,
      status: true,
      totalRecipients: true,
      scheduledAt: true,
      createdAt: true,
    },
  });
  const withStats = await Promise.all(
    campaigns.map(async (c) => ({ ...c, stats: await campaignStats(c.id) }))
  );
  return Response.json({ campaigns: withStats });
}

const createSchema = z
  .object({
    tenantId: z.string().optional(),
    name: z.string().min(1).max(120),
    mode: z.enum(["text", "template"]),
    body: z.string().max(4096).optional(),
    templateId: z.string().optional(),
    tags: z.array(z.string()).default([]),
    defaultVars: z.record(z.string()).optional(),
    scheduledAt: z.string().datetime().optional(),
    launchNow: z.boolean().default(true),
  })
  .refine((b) => b.mode !== "text" || (b.body && b.body.length > 0), { message: "body richiesto" })
  .refine((b) => b.mode !== "template" || !!b.templateId, { message: "templateId richiesto" });

export async function POST(req: Request): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const tenantId = await resolveTenantId(actor, parsed.data.tenantId ?? null);
  if (!tenantId) return Response.json({ error: "no tenant" }, { status: 400 });

  const session = await pickSession(tenantId);
  if (!session) return Response.json({ error: "no whatsapp session" }, { status: 409 });

  const b = parsed.data;
  const campaign = await db.campaign.create({
    data: {
      tenantId,
      sessionId: session.id,
      name: b.name,
      mode: b.mode === "template" ? "TEMPLATE" : "TEXT",
      body: b.body ?? null,
      templateId: b.templateId ?? null,
      defaultVars: { ...(b.defaultVars ?? {}), tags: b.tags },
      scheduledAt: b.scheduledAt ? new Date(b.scheduledAt) : null,
      status: "DRAFT",
    },
    select: { id: true },
  });

  if (b.launchNow) {
    const res = await launchCampaign(campaign.id);
    return Response.json({ id: campaign.id, ...res }, { status: 201 });
  }
  return Response.json({ id: campaign.id, enqueued: 0 }, { status: 201 });
}
```

- [ ] **Step 2: Implementare `[id]/route.ts` (GET dettaglio, DELETE = annulla)**

```ts
// src/app/api/campaigns/[id]/route.ts
import { db } from "@/lib/db";
import { auditLog } from "@/lib/audit";
import { getActor, canAccessTenant } from "@/lib/authz";
import { campaignStats } from "@/lib/outbound/campaign";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await db.campaign.findUnique({
    where: { id },
    select: {
      id: true,
      tenantId: true,
      name: true,
      mode: true,
      body: true,
      status: true,
      totalRecipients: true,
      scheduledAt: true,
      createdAt: true,
    },
  });
  if (!campaign || !canAccessTenant(actor, campaign.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const stats = await campaignStats(id);
  return Response.json({ campaign, stats });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const actor = await getActor();
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const campaign = await db.campaign.findUnique({ where: { id }, select: { tenantId: true } });
  if (!campaign || !canAccessTenant(actor, campaign.tenantId)) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  // Annulla i job ancora in coda + marca la campagna.
  await db.outboundJob.updateMany({
    where: { campaignId: id, status: "PENDING" },
    data: { status: "CANCELED", lastError: "campaign_canceled" },
  });
  await db.campaign.update({ where: { id }, data: { status: "CANCELED" } });
  await auditLog({
    userId: actor.userId,
    tenantId: campaign.tenantId,
    action: "campaign.cancel",
    entity: "Campaign",
    entityId: id,
  });
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: nessun errore.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/campaigns
git commit -m "feat(api): campaign routes (list/create+launch/detail/cancel)"
```

### Task 19: UI Campagne (lista + nuova) e dettaglio

**Files:**
- Create: `src/app/(app)/campagne/page.tsx`
- Create: `src/app/(app)/campagne/[id]/page.tsx`
- Modify: `src/app/(app)/app-nav.tsx` (aggiungere voce nav)

- [ ] **Step 1: Aggiungere la voce nav in `app-nav.tsx`**

In `import { Inbox, Smartphone, Settings, type LucideIcon } from "lucide-react";` aggiungere `Megaphone`:
```tsx
import { Inbox, Smartphone, Settings, Megaphone, type LucideIcon } from "lucide-react";
```
Nell'array `NAV`, dopo l'entry `/sessions`, inserire:
```tsx
  {
    href: "/campagne",
    label: "Campagne",
    icon: Megaphone,
    match: (p) => p.startsWith("/campagne"),
  },
```

- [ ] **Step 2: Implementare la lista `campagne/page.tsx`**

```tsx
// src/app/(app)/campagne/page.tsx
"use client";

/**
 * Campagne: lista con progresso (inviati/totale) + creazione rapida.
 * L'invio è spalmato nel tempo dal worker (anti-ban): la campagna parte in
 * RUNNING e avanza un messaggio per tick.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";

interface CampaignRow {
  id: string;
  name: string;
  mode: string;
  status: string;
  totalRecipients: number;
  stats: { total: number; pending: number; sent: number; failed: number };
}

export default function CampagnePage() {
  const [rows, setRows] = useState<CampaignRow[]>([]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await fetch("/api/campaigns");
    if (r.ok) setRows((await r.json()).campaigns);
  }
  useEffect(() => {
    void load();
    const t = setInterval(load, 10_000); // progresso live
    return () => clearInterval(t);
  }, []);

  async function create() {
    if (!name.trim() || !body.trim()) return;
    setBusy(true);
    const r = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), mode: "text", body, tags: [], launchNow: true }),
    });
    setBusy(false);
    if (r.ok) {
      setOpen(false);
      setName("");
      setBody("");
      void load();
    } else {
      alert((await r.json()).error ?? "errore");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-ink">Campagne</h1>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white"
        >
          <Plus size={16} />
          Nuova
        </button>
      </div>

      {open && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome campagna"
            className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base md:text-sm"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="Messaggio da inviare a tutti i contatti opt-in…"
            className="mt-2 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-base md:text-sm"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            Inviata solo ai contatti con consenso o che hanno già scritto. L&apos;invio è graduale
            (protezione anti-ban).
          </p>
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim() || !body.trim()}
            className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Megaphone size={16} />
            Lancia campagna
          </button>
        </div>
      )}

      <ul className="mt-6 space-y-3">
        {rows.length === 0 && (
          <li className="rounded-2xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            Nessuna campagna ancora.
          </li>
        )}
        {rows.map((c) => {
          const pct = c.stats.total ? Math.round((c.stats.sent / c.stats.total) * 100) : 0;
          return (
            <li key={c.id}>
              <Link
                href={`/campagne/${c.id}`}
                className="block rounded-2xl border border-border bg-surface p-4 hover:border-primary/40"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.status}</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.stats.sent}/{c.stats.total} inviati · {c.stats.pending} in coda · {c.stats.failed} falliti
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Implementare il dettaglio `campagne/[id]/page.tsx`**

```tsx
// src/app/(app)/campagne/[id]/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Ban } from "lucide-react";

interface Detail {
  campaign: { id: string; name: string; mode: string; body: string | null; status: string; totalRecipients: number };
  stats: { total: number; pending: number; sent: number; failed: number };
}

export default function CampagnaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Detail | null>(null);

  async function load() {
    const r = await fetch(`/api/campaigns/${id}`);
    if (r.ok) setData(await r.json());
  }
  useEffect(() => {
    void load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [id]);

  async function cancel() {
    if (!confirm("Annullare la campagna? I messaggi non ancora inviati verranno cancellati.")) return;
    await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
    void load();
  }

  if (!data) return <div className="p-6 text-sm text-muted-foreground">Caricamento…</div>;
  const { campaign, stats } = data;
  const pct = stats.total ? Math.round((stats.sent / stats.total) * 100) : 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <Link href="/campagne" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft size={16} /> Campagne
      </Link>
      <div className="mt-3 flex items-center justify-between">
        <h1 className="font-display text-xl font-semibold text-ink">{campaign.name}</h1>
        {(campaign.status === "RUNNING" || campaign.status === "DRAFT") && (
          <button
            type="button"
            onClick={cancel}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-xs text-red-600 hover:bg-red-50"
          >
            <Ban size={14} /> Annulla
          </button>
        )}
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-lg font-semibold text-ink">{stats.sent}</p>
            <p className="text-xs text-muted-foreground">inviati</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-ink">{stats.pending}</p>
            <p className="text-xs text-muted-foreground">in coda</p>
          </div>
          <div>
            <p className="text-lg font-semibold text-ink">{stats.failed}</p>
            <p className="text-xs text-muted-foreground">falliti</p>
          </div>
        </div>
      </div>

      {campaign.body && (
        <div className="mt-4 rounded-2xl border border-border bg-surface p-4">
          <p className="text-xs font-medium text-muted-foreground">Messaggio</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{campaign.body}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verifica build**

Run: `npm run build`
Expected: build OK; rotte `/campagne` e `/campagne/[id]` presenti.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/campagne" "src/app/(app)/app-nav.tsx"
git commit -m "feat(ui): campagne (lista, creazione, dettaglio con progresso)"
```

---

## Milestone M3.8 — Verifica integrata, deploy, cron

### Task 20: Suite test + typecheck + build completi

- [ ] **Step 1: Eseguire tutta la suite**

Run: `npm test`
Expected: PASS — `tests/apikey.test.ts`, `tests/outbound/pacing.test.ts`, `tests/outbound/template.test.ts` (tutti verdi).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: 0 errori; tutte le nuove rotte compilate (`/api/v1/messages`, `/api/internal/outbound/tick`, `/api/apikeys`, `/api/templates`, `/api/campaigns`, pagine `/campagne`, `/settings/sviluppatori`, `/settings/conversazioni/template`).

- [ ] **Step 3: Commit (se servono fix)**

```bash
git add -A
git commit -m "test: Fase 3 suite verde + build pulita"
```

### Task 21: Deploy + cron worker + verifica E2E sul live

- [ ] **Step 1: Push e deploy**

```bash
git push origin main
```
Triggera il deploy Coolify di `openwa-web` (applica `prisma migrate deploy` allo start → crea le tabelle Fase 3). Attendere `running:healthy` + `/api/health` 200.

- [ ] **Step 2: Installare il cron del worker**

In Coolify creare una **Scheduled Task** sull'app `openwa-web` (oppure cron di sistema sul server, come `wa-keepalive`):
- Frequenza: `* * * * *` (ogni minuto)
- Comando:
  ```bash
  curl -fsS -m 50 -X POST http://openwa-web:3000/api/internal/outbound/tick \
    -H "Authorization: Bearer $INTERNAL_GATEWAY_SECRET"
  ```
Verificare un'esecuzione manuale: deve rispondere `{"ok":true,"processed":...,"sent":...}`.

- [ ] **Step 3: E2E API privata sul live**

1. Creare una API key da `https://openwa.isipc.com/settings/sviluppatori` (copiare il plaintext).
2. Inviare a un numero che ha già scritto al bot (opt-in implicito):
   ```bash
   curl -X POST https://openwa.isipc.com/api/v1/messages \
     -H "X-Api-Key: owa_live_..." -H "Content-Type: application/json" \
     -d '{"to":"+39...","mode":"text","text":"Test API privata OpenWA"}'
   ```
   Expected: `202 {"jobId":"...","status":"PENDING"}`.
3. Attendere ≤1 min (un tick del cron), poi:
   ```bash
   curl https://openwa.isipc.com/api/v1/messages/<jobId> -H "X-Api-Key: owa_live_..."
   ```
   Expected: `status:"DONE"`, `messageStatus:"SENT"`; il messaggio appare in inbox e arriva su WhatsApp.
4. Verificare il gate opt-in: inviare a un numero **nuovo** senza `optIn` → atteso `403 opt_in_required`; con `"optIn":true` → `202`.

- [ ] **Step 4: E2E campagna**

Da `https://openwa.isipc.com/campagne` creare una campagna di test (testo breve) e verificare che la barra di progresso avanzi di ~1 invio/minuto (pacing anti-ban) fino a completamento, senza ban della sessione.

- [ ] **Step 5: Aggiornare credenziali/blueprint**

Annotare in `C:\PROGETTI\CREDENZIALI_OpenWA.txt` lo stato "FASE 3 LIVE" con: endpoint API privata, cron worker installato, e che le API key sono per-tenant (hash in DB). Nessun nuovo segreto infrastrutturale (riusato `INTERNAL_GATEWAY_SECRET`).

- [ ] **Step 6: Commit finale (docs)**

```bash
git add -A
git commit -m "docs: Fase 3 LIVE — API privata + campagne operative"
git push origin main
```

---

## Self-Review (coverage vs spec)

- **API privata `POST /api/v1/messages` (text/template/intent)** → Task 11 ✓
- **Auth API-key `X-Api-Key` + `timingSafeEqual`** → Task 2/3 ✓
- **Scope per key** → Task 11 (`hasScope("messages:send")`) ✓
- **Coda `OutboundJob` su Postgres** → Task 1/7 ✓
- **Throttling anti-ban (delay, cap giorno/ora, opt-in, orari, stop su ban)** → Task 5 (logica pura) + Task 8 (applicazione) ✓
- **Risposta `202 { jobId }`** → Task 11 ✓
- **Pacing globale per sessione** → Task 8 (`MAX_PER_SESSION_PER_TICK` + cron) ✓
- **Template + variabili** → Task 6/15/16 ✓
- **Campagne UI (liste, scheduling, report)** → Task 17/18/19 ✓
- **Audit su invii e mutazioni** → Task 8/11/13/15/18 (`auditLog`) ✓
- **IDOR scoping** → Task 12/13/14/15/18 (tenant filter su ogni `/[id]`) ✓
- **Delivery feedback** → Task 12 (`GET /api/v1/messages/:id`) ✓

**Note di non-copertura volutamente rinviate (YAGNI / Fase 4):** warm-up progressivo dei numeri (flag `warmupMode` esiste ma non riduce ancora i cap nei primi giorni — migliorabile in seguito), media/allegati outbound (solo testo per ora), provider OpenAI per il modo intent (resta Bedrock).
