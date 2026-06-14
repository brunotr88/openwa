# Configurazione per-numero + API key per numero — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere ogni numero WhatsApp (`WaSession`) un bot completo indipendente (settings + AiConfig propri), con API key legata a un numero specifico, mantenendo il numero live di produzione funzionante durante tutta la transizione.

**Architecture:** Approccio A dello spec: la configurazione vive sul `WaSession` (`settings Json`), `AiConfig` diventa per-sessione (`sessionId @unique`), `ApiKey` ottiene `sessionId`. Migrazione **tutta additiva** (colonne nullable + backfill idempotente nello start), poi le pipeline passano da letture per-tenant a per-sessione con fallback al tenant durante la transizione. Rollout in 6 stage, ognuno deployabile.

**Tech Stack:** Next.js 15 App Router, TS strict, Prisma 6 + Postgres, zod, vitest (TDD sulle funzioni pure). No DB locale → migrazioni via `prisma migrate diff` tra datamodel. Spec: `docs/superpowers/specs/2026-06-14-openwa-per-number-config-design.md`.

**Convenzioni note (dal codice esistente):**
- Test in `tests/**/*.test.ts`, `npm test`. Alias `@`→`src`. Esiste già una suite (211 test) da tenere verde.
- Prisma client: `import { db } from "@/lib/db"`.
- Settings: `parseTenantSettings(stored)` (pure, `src/lib/settings/merge.ts`), `deepMerge`, `tenantSettingsSchema`, `recommendedDefaults`.
- Migrazioni senza DB: `git show HEAD:prisma/schema.prisma > /tmp/prev.prisma` poi `PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma migrate diff --from-schema-datamodel /tmp/prev.prisma --to-schema-datamodel prisma/schema.prisma --script > .../migration.sql`. Validare con `DATABASE_URL="postgresql://u:u@localhost:5432/u" npx prisma validate`.
- Le migrazioni vengono applicate allo start da `scripts/start.sh` (`prisma migrate deploy` → `node scripts/seed-runner.js` → server).

---

## File Structure

**Nuovi file:**
- `src/lib/settings/session.ts` — `parseSettingsWithFallback` (pura), `getSessionSettings`, `saveSessionSettings` (glue DB).
- `src/lib/sessions/primary.ts` — `pickPrimarySession` (pura, usata da migrazione e API/UI).
- `src/app/api/v1/me/route.ts` — GET numero legato alla key.
- `tests/settings-session.test.ts`, `tests/sessions-primary.test.ts` — unit.

**File modificati:**
- `prisma/schema.prisma` (+ migrazione) — `WaSession.settings`, `AiConfig.sessionId`, `ApiKey.sessionId`.
- `scripts/seed-runner.js` — backfill idempotente.
- `src/lib/api-auth.ts` — `ApiKeyActor` con `sessionId`.
- `src/lib/wa/reply.ts`, `src/app/api/webhooks/wa/route.ts`, `src/lib/outbound/worker.ts`, `src/app/api/playground/route.ts` — letture per-sessione + cap per-sessione.
- `src/app/api/v1/messages/route.ts` — usa `key.sessionId` (no `from`/`pickSession`).
- `src/app/api/apikeys/route.ts` — `sessionId` obbligatorio in creazione.
- `src/app/api/settings/route.ts` — keyed by `sessionId`.
- `src/app/(app)/settings/layout.tsx`, `src/components/settings/settings-shell.tsx`, `src/components/settings/settings-context.tsx`, `src/app/(app)/settings/sviluppatori/page.tsx`, `src/app/(app)/setup/page.tsx`, `src/app/(app)/inbox/page.tsx` — selettore numero + key-per-numero.
- `docs/API-INTEGRAZIONE.md` — modello "una key per numero".

---

## STAGE M1 — Schema + migrazione (additiva) + backfill

### Task 1: Schema Prisma — colonne additive nullable

**Files:** Modify `prisma/schema.prisma`.

- [ ] **Step 1: WaSession — aggiungere `settings` + relazioni inverse**

In `model WaSession`, aggiungere il campo (dopo `sessionDataRef`) e le relazioni inverse:
```prisma
  settings       Json?           // TenantSettings shape — config del numero (per-bot)
```
e tra le relazioni (dopo `conversations Conversation[]` / le altre già presenti):
```prisma
  aiConfig      AiConfig?
  apiKeys       ApiKey[]
```

- [ ] **Step 2: AiConfig — da per-tenant a per-sessione (nullable-unique, additivo)**

Sostituire l'header del model `AiConfig` rimuovendo `@unique` da `tenantId` e aggiungendo `sessionId`:
```prisma
model AiConfig {
  id                 String         @id @default(cuid())
  tenantId           String                          // ERA @unique — rimosso
  sessionId          String?        @unique          // numero del bot (nullable per migrazione; sempre valorizzato a runtime)
  provider           AiProviderType @default(BEDROCK)
  modelId            String         @default("eu.anthropic.claude-sonnet-4-5-20250929-v1:0")
  systemPrompt       String?
  temperature        Float          @default(0.7)
  autoReplyEnabled   Boolean        @default(false)
  businessHours      Json?
  updatedAt          DateTime       @updatedAt

  tenant  Tenant     @relation(fields: [tenantId], references: [id])
  session WaSession? @relation(fields: [sessionId], references: [id])

  @@index([tenantId])
}
```

- [ ] **Step 3: ApiKey — aggiungere `sessionId`**

In `model ApiKey`, aggiungere (dopo `tenantId`):
```prisma
  sessionId  String?
```
e tra le relazioni:
```prisma
  session WaSession? @relation(fields: [sessionId], references: [id])
```

- [ ] **Step 4: Generare la migrazione (senza DB)**

Run:
```bash
cd /mnt/c/PROGETTI/SOFTWARES/OpenWA
git show HEAD:prisma/schema.prisma > /tmp/prev-schema.prisma
MIG="prisma/migrations/$(date -u +%Y%m%d%H%M%S)_per_number_config"
mkdir -p "$MIG"
PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma migrate diff \
  --from-schema-datamodel /tmp/prev-schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "$MIG/migration.sql"
cat "$MIG/migration.sql"
DATABASE_URL="postgresql://u:u@localhost:5432/u" PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma validate
PRISMA_HIDE_UPDATE_MESSAGE=1 npx prisma generate
```
Expected: l'SQL deve essere **solo additivo** — `ALTER TABLE "WaSession" ADD COLUMN "settings" JSONB`, `ALTER TABLE "AiConfig" ADD COLUMN "sessionId" TEXT`, `DROP INDEX "AiConfig_tenantId_key"`, `CREATE UNIQUE INDEX "AiConfig_sessionId_key"`, `ALTER TABLE "ApiKey" ADD COLUMN "sessionId" TEXT`, + le FK. NESSUN `NOT NULL` su colonne nuove (sicuro sulle righe esistenti). `prisma validate` e `prisma generate` devono passare.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): per-number config — WaSession.settings, AiConfig.sessionId, ApiKey.sessionId (additivo)"
```

### Task 2: `pickPrimarySession` (pura) — TDD

**Files:** Create `src/lib/sessions/primary.ts`, `tests/sessions-primary.test.ts`.

- [ ] **Step 1: Test che fallisce**

```ts
// tests/sessions-primary.test.ts
import { describe, it, expect } from "vitest";
import { pickPrimarySession } from "@/lib/sessions/primary";

const s = (id: string, status: string, iso: string) => ({ id, status, createdAt: new Date(iso) });

describe("pickPrimarySession", () => {
  it("ritorna null se nessuna sessione", () => {
    expect(pickPrimarySession([])).toBeNull();
  });
  it("preferisce la CONNECTED più recente", () => {
    const out = pickPrimarySession([
      s("a", "OFFLINE", "2026-06-10T00:00:00Z"),
      s("b", "CONNECTED", "2026-06-11T00:00:00Z"),
      s("c", "CONNECTED", "2026-06-12T00:00:00Z"),
    ]);
    expect(out).toBe("c");
  });
  it("senza CONNECTED, ritorna la più recente in assoluto", () => {
    const out = pickPrimarySession([
      s("a", "OFFLINE", "2026-06-10T00:00:00Z"),
      s("b", "QR", "2026-06-12T00:00:00Z"),
    ]);
    expect(out).toBe("b");
  });
});
```

- [ ] **Step 2: Eseguire (FAIL)** — `npm test -- tests/sessions-primary.test.ts` → modulo non trovato.

- [ ] **Step 3: Implementare**

```ts
// src/lib/sessions/primary.ts
/** Sessione "primaria" di un insieme: la CONNECTED più recente, altrimenti la
 *  più recente in assoluto. Pura — usata da migrazione, API e UI. */
export interface SessionLike {
  id: string;
  status: string;
  createdAt: Date;
}

export function pickPrimarySession(sessions: SessionLike[]): string | null {
  if (sessions.length === 0) return null;
  const byNewest = [...sessions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  const connected = byNewest.find((s) => s.status === "CONNECTED");
  return (connected ?? byNewest[0]).id;
}
```

- [ ] **Step 4: Eseguire (PASS)** — `npm test -- tests/sessions-primary.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessions/primary.ts tests/sessions-primary.test.ts
git commit -m "feat(sessions): pickPrimarySession (pure)"
```

### Task 3: Backfill idempotente nello start

**Files:** Modify `scripts/seed-runner.js`.

- [ ] **Step 1: Leggere il file** per individuare dove aggiungere lo step (dopo il seed esistente, prima della chiusura). Usa lo stesso client Prisma già importato nel file.

- [ ] **Step 2: Aggiungere la funzione di backfill** e chiamarla. Inserire (adattando al `PrismaClient`/`prisma` già presente nel file — se il file usa `const { PrismaClient } = require("@prisma/client"); const prisma = new PrismaClient();`, riusa `prisma`):

```js
// --- Backfill per-number config (idempotente) ---
async function backfillPerNumberConfig(prisma) {
  // Helper: sessione primaria (CONNECTED più recente, altrimenti più recente).
  function pickPrimary(sessions) {
    if (!sessions.length) return null;
    const byNewest = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
    return (byNewest.find((s) => s.status === "CONNECTED") ?? byNewest[0]).id;
  }

  const tenants = await prisma.tenant.findMany({ select: { id: true, settings: true } });
  for (const t of tenants) {
    const sessions = await prisma.waSession.findMany({
      where: { tenantId: t.id, deletedAt: null },
      select: { id: true, status: true, createdAt: true, settings: true },
    });
    if (!sessions.length) continue;

    // 1. WaSession.settings: copia Tenant.settings dove manca.
    for (const s of sessions) {
      if (s.settings == null && t.settings != null) {
        await prisma.waSession.update({ where: { id: s.id }, data: { settings: t.settings } });
      }
    }

    const primaryId = pickPrimary(sessions);

    // 2. AiConfig: assegna l'esistente (senza sessionId) alla sessione primaria;
    //    crea una AiConfig di default per le altre sessioni che non ne hanno.
    const orphan = await prisma.aiConfig.findFirst({
      where: { tenantId: t.id, sessionId: null },
    });
    if (orphan && primaryId) {
      const taken = await prisma.aiConfig.findUnique({ where: { sessionId: primaryId } });
      if (!taken) {
        await prisma.aiConfig.update({ where: { id: orphan.id }, data: { sessionId: primaryId } });
      }
    }
    for (const s of sessions) {
      const has = await prisma.aiConfig.findUnique({ where: { sessionId: s.id } });
      if (!has) {
        await prisma.aiConfig.create({ data: { tenantId: t.id, sessionId: s.id } });
      }
    }

    // 3. ApiKey senza sessionId → legate alla sessione primaria.
    if (primaryId) {
      await prisma.apiKey.updateMany({
        where: { tenantId: t.id, sessionId: null, deletedAt: null },
        data: { sessionId: primaryId },
      });
    }
  }
  console.log("[seed] backfill per-number config: done");
}
```
e chiamarla nel flusso principale del seed (dentro la funzione async esistente, dopo il seed):
```js
await backfillPerNumberConfig(prisma);
```

- [ ] **Step 3: Verifica sintassi** — `node --check scripts/seed-runner.js` → nessun errore.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-runner.js
git commit -m "feat(db): backfill idempotente config per-numero allo start"
```

> **Deploy Stage M1:** dopo M1 si fa un deploy (push → Coolify): la migrazione additiva crea le colonne, il seed-runner fa il backfill. Le pipeline leggono ancora per-tenant (compatibile). Verifica: numero live invariato, `AiConfig` del numero ha `sessionId`, `WaSession.settings` popolato. **Il deploy è un'azione di produzione: vedi Stage M6 per la procedura e i checkpoint.**

---

## STAGE M2 — Modulo settings per-sessione

### Task 4: `parseSettingsWithFallback` (pura) + `getSessionSettings`/`saveSessionSettings`

**Files:** Create `src/lib/settings/session.ts`, `tests/settings-session.test.ts`.

- [ ] **Step 1: Test che fallisce (parte pura)**

```ts
// tests/settings-session.test.ts
import { describe, it, expect } from "vitest";
import { parseSettingsWithFallback } from "@/lib/settings/session";

describe("parseSettingsWithFallback", () => {
  it("usa i settings della sessione se presenti", () => {
    const out = parseSettingsWithFallback(
      { persona: { botName: "BotSessione" } },
      { persona: { botName: "BotTenant" } }
    );
    expect(out.persona.botName).toBe("BotSessione");
  });
  it("fa fallback ai settings del tenant se la sessione è null", () => {
    const out = parseSettingsWithFallback(null, { persona: { botName: "BotTenant" } });
    expect(out.persona.botName).toBe("BotTenant");
  });
  it("usa i default se entrambi null (campi sempre valorizzati)", () => {
    const out = parseSettingsWithFallback(null, null);
    expect(out.behavior.aiMode).toBe("COPILOT"); // default da schema
    expect(out.sending.businessHoursOnlyOutbound).toBe(true);
  });
});
```

- [ ] **Step 2: Eseguire (FAIL)** — `npm test -- tests/settings-session.test.ts`.

- [ ] **Step 3: Implementare**

```ts
// src/lib/settings/session.ts
/**
 * Settings per-numero (WaSession.settings). parseSettingsWithFallback è pura:
 * sceglie la sorgente (sessione → tenant → default) e la valida con i merge
 * esistenti. get/save sono i wrapper DB.
 */
import { db } from "@/lib/db";
import type { TenantSettings } from "./schema";
import { tenantSettingsSchema } from "./schema";
import { deepMerge, isPlainObject, parseTenantSettings } from "./merge";

/** Sorgente effettiva: settings sessione se non null, altrimenti tenant, altrimenti default. */
export function parseSettingsWithFallback(
  sessionStored: unknown,
  tenantStored: unknown
): TenantSettings {
  if (sessionStored != null) return parseTenantSettings(sessionStored);
  if (tenantStored != null) return parseTenantSettings(tenantStored);
  return parseTenantSettings(null);
}

export async function getSessionSettings(sessionId: string): Promise<TenantSettings> {
  const session = await db.waSession.findUnique({
    where: { id: sessionId },
    select: { settings: true, tenant: { select: { settings: true } } },
  });
  return parseSettingsWithFallback(session?.settings ?? null, session?.tenant?.settings ?? null);
}

/** Deep-merge del patch sopra i settings effettivi del numero, validazione, persist su WaSession.settings. */
export async function saveSessionSettings(
  sessionId: string,
  patch: unknown
): Promise<TenantSettings> {
  const current = await getSessionSettings(sessionId);
  const merged = deepMerge(current, isPlainObject(patch) ? patch : {});
  const next = tenantSettingsSchema.parse(merged);
  await db.waSession.update({ where: { id: sessionId }, data: { settings: next } });
  return next;
}
```

- [ ] **Step 4: Eseguire (PASS)** — `npm test -- tests/settings-session.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings/session.ts tests/settings-session.test.ts
git commit -m "feat(settings): get/save session settings + parseSettingsWithFallback (pure)"
```

---

## STAGE M3 — Pipeline per-sessione (con fallback al tenant)

### Task 5: `authenticateApiKey` ritorna `sessionId`

**Files:** Modify `src/lib/api-auth.ts`.

- [ ] **Step 1: Aggiungere `sessionId` all'actor.** Sostituire l'interfaccia e il return:

```ts
export interface ApiKeyActor {
  keyId: string;
  tenantId: string;
  sessionId: string | null;
  scopes: string[];
}
```
e nel return di `authenticateApiKey`:
```ts
  return { keyId: record.id, tenantId: record.tenantId, sessionId: record.sessionId, scopes: record.scopes };
```
(Il `select`/`findUnique` di default ritorna già tutti i campi, incluso `sessionId`.)

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`. Atteso: errori SOLO nei consumer che ora devono gestire `sessionId` (li sistemiamo nei task seguenti). Se `tsc` segnala `api/v1/messages` non ancora aggiornato, è atteso: prosegui col Task 10 prima del commit finale, oppure committa questo task insieme al Task 10. **Per mantenere verde:** committa dopo aver completato anche il Task 10.

- [ ] **Step 3: Commit (insieme al Task 10)** — vedi Task 10.

### Task 6: `reply.ts` → settings + AiConfig per sessione

**Files:** Modify `src/lib/wa/reply.ts`.

- [ ] **Step 1: Cambiare l'import** da `getTenantSettings` a `getSessionSettings`. In testa, aggiungere:
```ts
import { getSessionSettings } from "@/lib/settings/session";
```

- [ ] **Step 2: Sostituire la load dei settings.** Trovare:
```ts
  const settings = await getTenantSettings(conversation.tenantId);
```
e sostituire con:
```ts
  const settings = await getSessionSettings(conversation.sessionId);
```

- [ ] **Step 3: Sostituire la load di AiConfig per sessione.** Trovare:
```ts
  const aiConfig = await db.aiConfig.findUnique({
    where: { tenantId: conversation.tenantId },
  });
```
e sostituire con:
```ts
  const aiConfig = await db.aiConfig.findUnique({
    where: { sessionId: conversation.sessionId },
  });
```

- [ ] **Step 4: Typecheck + suite** — `npx tsc --noEmit && npm test`. Atteso: 0 errori, suite verde (i test esistenti di `reply` usano mock; verificare che non si basino su `getTenantSettings` — se sì, aggiornarli a `getSessionSettings`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/wa/reply.ts tests/
git commit -m "feat(pipeline): reply.ts usa settings + AiConfig per-sessione"
```

### Task 7: `webhook/wa` → settings per sessione

**Files:** Modify `src/app/api/webhooks/wa/route.ts`.

- [ ] **Step 1: Cambiare import + chiamata.** Aggiungere import:
```ts
import { getSessionSettings } from "@/lib/settings/session";
```
Trovare:
```ts
  const settings = await getTenantSettings(session.tenantId);
```
e sostituire con (la `session` è già caricata sopra, `session.id` è il WaSession id):
```ts
  const settings = await getSessionSettings(session.id);
```
Rimuovere l'import ora inutilizzato `getTenantSettings` se non più usato altrove nel file.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/webhooks/wa/route.ts
git commit -m "feat(pipeline): webhook usa settings per-sessione"
```

### Task 8: `worker.ts` → settings + AiConfig + cap per sessione

**Files:** Modify `src/lib/outbound/worker.ts`.

- [ ] **Step 1: Import.** Aggiungere:
```ts
import { getSessionSettings } from "@/lib/settings/session";
```
e rimuovere `getTenantSettings` dall'import di `@/lib/settings` se non più usato.

- [ ] **Step 2: settings per sessione.** In `sendOneJob`, trovare:
```ts
  const settings = await getTenantSettings(job.tenantId);
```
e sostituire con:
```ts
  const settings = await getSessionSettings(job.sessionId);
```

- [ ] **Step 3: cap/spacing PER SESSIONE.** Nei tre conteggi `db.message.count`/`findFirst` dentro il `Promise.all([...])`, cambiare il filtro da `tenantId` a relazione sulla sessione. Sostituire il blocco:
```ts
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
```
con (filtro per sessione via `conversation.sessionId`):
```ts
  const sessionFilter = { conversation: { sessionId: job.sessionId } } as const;
  const [sentToday, sentThisHour, lastOut] = await Promise.all([
    db.message.count({
      where: {
        ...sessionFilter,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfDay },
      },
    }),
    db.message.count({
      where: {
        ...sessionFilter,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: startOfHour },
      },
    }),
    db.message.findFirst({
      where: {
        ...sessionFilter,
        direction: "OUT",
        status: { in: ["SENT", "DELIVERED", "READ"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
```
e aggiornare il commento "per-TENANT" aggiunto in Fase 3 in "per-SESSIONE (numero)".

- [ ] **Step 4: AiConfig per sessione (modo intent).** In `resolveBody`, trovare:
```ts
  const aiConfig = await db.aiConfig.findUnique({ where: { tenantId: job.tenantId } });
```
e sostituire con:
```ts
  const aiConfig = await db.aiConfig.findUnique({ where: { sessionId: job.sessionId } });
```

- [ ] **Step 5: Typecheck + suite** — `npx tsc --noEmit && npm test` → 0 errori, suite verde.

- [ ] **Step 6: Commit**

```bash
git add src/lib/outbound/worker.ts
git commit -m "feat(outbound): worker usa settings/AiConfig per-sessione + cap anti-ban per numero"
```

### Task 9: `playground` → per sessione

**Files:** Modify `src/app/api/playground/route.ts`.

- [ ] **Step 1: Accettare `sessionId` nel body + usarlo.** Aggiungere `sessionId` allo schema zod del body:
```ts
  sessionId: z.string().min(1).optional(),
```
Aggiungere import:
```ts
import { getSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
```
Dopo aver risolto `tenantId`, risolvere il `sessionId` (esplicito o primario del tenant):
```ts
  let sessionId = parsed.data.sessionId ?? null;
  if (!sessionId) {
    const sessions = await db.waSession.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, status: true, createdAt: true },
    });
    sessionId = pickPrimarySession(sessions);
  }
  if (!sessionId) {
    return Response.json({ error: "no number available" }, { status: 409 });
  }
```
Sostituire:
```ts
  const saved = await getTenantSettings(tenantId);
```
con:
```ts
  const saved = await getSessionSettings(sessionId);
```
e:
```ts
  const aiConfig = await db.aiConfig.findUnique({ where: { tenantId } });
```
con:
```ts
  const aiConfig = await db.aiConfig.findUnique({ where: { sessionId } });
```
Rimuovere l'import `getTenantSettings` se non più usato.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/playground/route.ts
git commit -m "feat(playground): generazione per-sessione (numero)"
```

> **Deploy Stage M3:** push → deploy. Verifica: inbound del numero live continua a generare risposte (settings del numero), outbound rispetta cap/orari del numero, playground funziona. Vedi M6.

---

## STAGE M4 — API key per numero

### Task 10: `POST /api/v1/messages` usa `key.sessionId` (no `from`)

**Files:** Modify `src/app/api/v1/messages/route.ts`.

- [ ] **Step 1: Sostituire la risoluzione sessione.** Rimuovere l'uso di `pickSession`. Trovare:
```ts
  const session = await pickSession(actor.tenantId);
  if (!session) return Response.json({ error: "no whatsapp session" }, { status: 409 });
```
e sostituire con (il numero è quello legato alla key):
```ts
  if (!actor.sessionId) {
    return Response.json({ error: "number_unavailable", hint: "la API key non è legata a un numero" }, { status: 409 });
  }
  const session = await db.waSession.findFirst({
    where: { id: actor.sessionId, deletedAt: null },
    select: { id: true },
  });
  if (!session) return Response.json({ error: "number_unavailable" }, { status: 409 });
```
Aggiornare gli import: rimuovere `pickSession` da `@/lib/outbound/enqueue` (mantenere `enqueueOutbound`, `resolveSendableContact`, `ensureConversation`); aggiungere `import { db } from "@/lib/db";` se non presente.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` (ora anche `api-auth` del Task 5 typecheck-a). Atteso 0 errori.

- [ ] **Step 3: Commit (insieme al Task 5)**

```bash
git add src/lib/api-auth.ts src/app/api/v1/messages/route.ts
git commit -m "feat(api): invio dal numero legato alla key (no from/pickSession)"
```

### Task 11: `GET /api/v1/me`

**Files:** Create `src/app/api/v1/me/route.ts`.

- [ ] **Step 1: Implementare**

```ts
// src/app/api/v1/me/route.ts
/** Numero legato alla API key (così il chiamante sa da che numero invia). */
import { db } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const actor = await authenticateApiKey(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!actor.sessionId) {
    return Response.json({ error: "number_unavailable" }, { status: 409 });
  }
  const session = await db.waSession.findFirst({
    where: { id: actor.sessionId, deletedAt: null },
    select: { id: true, phoneLabel: true, status: true },
  });
  if (!session) return Response.json({ error: "number_unavailable" }, { status: 409 });
  return Response.json({
    sessionId: session.id,
    phoneLabel: session.phoneLabel,
    status: session.status,
    scopes: actor.scopes,
  });
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → 0 errori.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/v1/me/route.ts
git commit -m "feat(api): GET /api/v1/me (numero legato alla key)"
```

### Task 12: Creazione key con scelta del numero (route + UI)

**Files:** Modify `src/app/api/apikeys/route.ts`, `src/app/(app)/settings/sviluppatori/page.tsx`.

- [ ] **Step 1: Route — `sessionId` obbligatorio + validazione appartenenza.** In `createSchema` aggiungere:
```ts
  sessionId: z.string().min(1),
```
Nel `POST`, dopo aver risolto `tenantId`, verificare che la sessione appartenga al tenant accessibile:
```ts
  const session = await db.waSession.findFirst({
    where: { id: parsed.data.sessionId, tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!session) return Response.json({ error: "numero non valido" }, { status: 400 });
```
e nella `db.apiKey.create({ data: { ... } })` aggiungere `sessionId: session.id`. Nel `GET` (lista key), aggiungere `sessionId` e il label del numero al `select`:
```ts
    select: { id: true, prefix: true, label: true, scopes: true, lastUsedAt: true, createdAt: true,
      sessionId: true, session: { select: { phoneLabel: true } } },
```

- [ ] **Step 2: UI Sviluppatori — selettore numero alla creazione.** In `src/app/(app)/settings/sviluppatori/page.tsx`:
  - Caricare i numeri del tenant: aggiungere stato `numbers` e fetch da `/api/sessions` (endpoint esistente che ritorna `{ sessions: [{id, phoneLabel, status}] }`).
  - Aggiungere uno stato `sessionId` e un `<select>` accanto all'input etichetta:
```tsx
  const [numbers, setNumbers] = useState<{ id: string; phoneLabel: string; status: string }[]>([]);
  const [sessionId, setSessionId] = useState<string>("");
  useEffect(() => {
    fetch("/api/sessions").then((r) => r.json()).then((d) => {
      setNumbers(d.sessions ?? []);
      if (d.sessions?.[0]) setSessionId(d.sessions[0].id);
    }).catch(() => {});
  }, []);
```
  - Nel form di creazione, prima del bottone "Crea key", aggiungere il select:
```tsx
  <select
    value={sessionId}
    onChange={(e) => setSessionId(e.target.value)}
    className="rounded-xl border border-border bg-surface px-3 py-2.5 text-base shadow-sm md:text-sm"
  >
    {numbers.length === 0 && <option value="">Nessun numero collegato</option>}
    {numbers.map((n) => (
      <option key={n.id} value={n.id}>{n.phoneLabel} ({n.status})</option>
    ))}
  </select>
```
  - In `create()`, includere `sessionId` nel body e disabilitare il bottone se `!sessionId`:
```tsx
    body: JSON.stringify({ label: label.trim(), scopes: ["messages:send"], sessionId }),
```
  - Nella lista key, mostrare il numero: aggiungere `sessionPhoneLabel?` al tipo `ApiKeyRow` (dal `session.phoneLabel` del GET) e renderizzarlo accanto al prefisso, es. `· numero {k.sessionPhoneLabel}`.

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit && npm run build` → 0 errori, rotte presenti.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/apikeys/route.ts "src/app/(app)/settings/sviluppatori/page.tsx"
git commit -m "feat(api+ui): API key legata a un numero (selettore in Sviluppatori)"
```

> **Deploy Stage M4:** push → deploy. La migrazione M1 ha già legato la key di test al numero. Verifica E2E: `GET /api/v1/me` ritorna il numero; invio via la key parte da quel numero. Vedi M6.

---

## STAGE M5 — UI impostazioni per-numero

### Task 13: `api/settings` keyed by `sessionId`

**Files:** Modify `src/app/api/settings/route.ts`.

- [ ] **Step 1: GET per sessione.** Sostituire l'uso di `getTenantSettings(tenantId)` con la risoluzione del numero. Aggiungere import:
```ts
import { getSessionSettings, saveSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
```
Nel `GET`, dopo aver risolto `tenantId`, risolvere `sessionId` da querystring `?sessionId=` (validandone l'appartenenza al tenant) o primario:
```ts
  const requestedSession = new URL(req.url).searchParams.get("sessionId");
  const sessions = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, status: true, createdAt: true, phoneLabel: true },
  });
  const sessionId =
    (requestedSession && sessions.some((s) => s.id === requestedSession) && requestedSession) ||
    pickPrimarySession(sessions);
  if (!sessionId) {
    return Response.json({ tenantId, sessionId: null, settings: null, numbers: sessions, sentToday: 0 });
  }
  const settings = await getSessionSettings(sessionId);
```
Cambiare il conteggio `sentToday` a per-sessione:
```ts
  const sentToday = await db.message.count({
    where: {
      conversation: { sessionId },
      direction: "OUT",
      status: { in: ["SENT", "DELIVERED", "READ"] },
      createdAt: { gte: startOfDay },
    },
  });
  return Response.json({ tenantId, sessionId, settings, numbers: sessions, sentToday });
```

- [ ] **Step 2: PUT per sessione.** Cambiare il body da `{ tenantId?, settings }` a `{ sessionId, settings }`. Validare l'appartenenza del `sessionId` a un tenant accessibile, poi:
```ts
  // body: { sessionId: string, settings: object }
  const sessionId = body.sessionId;
  const session = sessionId
    ? await db.waSession.findFirst({ where: { id: sessionId, ...tenantFilterForActor }, select: { id: true } })
    : null;
  if (!session) return Response.json({ error: "numero non valido" }, { status: 400 });
  // ...
  const settings = await saveSessionSettings(sessionId, body.settings);
```
(Per `tenantFilterForActor`: riusa `getActor()` + `canAccessTenant`. Concretamente: carica la sessione con il suo `tenantId` e verifica `canAccessTenant(actor, session.tenantId)`.) Aggiornare l'audit log per usare `entity: "WaSession", entityId: sessionId`.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → 0 errori.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/settings/route.ts
git commit -m "feat(settings): API settings per-numero (sessionId)"
```

### Task 14: Settings layout + shell + context → selettore numero

**Files:** Modify `src/app/(app)/settings/layout.tsx`, `src/components/settings/settings-shell.tsx`, `src/components/settings/settings-context.tsx`.

- [ ] **Step 1: Layout — caricare numeri + sessione selezionata.** Sostituire `src/app/(app)/settings/layout.tsx`:
```tsx
import { redirect } from "next/navigation";
import { getActor, resolveTenantId } from "@/lib/authz";
import { getSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
import { db } from "@/lib/db";
import { SettingsShell } from "@/components/settings/settings-shell";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
  searchParams,
}: {
  children: React.ReactNode;
  searchParams: Promise<{ sessionId?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const tenantId = await resolveTenantId(actor);
  if (!tenantId) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center text-sm text-muted-foreground">
        Nessun workspace disponibile per questo utente.
      </div>
    );
  }
  const numbers = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, phoneLabel: true, status: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  if (numbers.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-12 text-center text-sm text-muted-foreground">
        Nessun numero collegato. <a href="/sessions" className="text-primary underline">Collega un numero</a> per configurarlo.
      </div>
    );
  }
  const requested = (await searchParams).sessionId;
  const sessionId =
    (requested && numbers.some((n) => n.id === requested) && requested) ||
    pickPrimarySession(numbers)!;
  const settings = await getSessionSettings(sessionId);

  return (
    <SettingsShell
      tenantId={tenantId}
      sessionId={sessionId}
      numbers={numbers.map((n) => ({ id: n.id, phoneLabel: n.phoneLabel, status: n.status }))}
      initialSettings={settings}
    >
      {children}
    </SettingsShell>
  );
}
```

- [ ] **Step 2: Shell — props numero + selettore.** In `src/components/settings/settings-shell.tsx`:
  - Estendere le props con `sessionId: string` e `numbers: { id: string; phoneLabel: string; status: string }[]`.
  - Passare `sessionId` al `SettingsProvider` (`<SettingsProvider sessionId={sessionId} tenantId={tenantId} initialSettings={initialSettings}>`).
  - Aggiungere in cima alla colonna nav un `<select>` che, al cambio, naviga a `?sessionId=<id>` (preservando il pathname). Esempio (client — la shell è già `"use client"` o lo diventa per questo; se è server, estrarre un piccolo client component `NumberSwitcher`):
```tsx
// NumberSwitcher (client): naviga cambiando ?sessionId=
"use client";
import { useRouter, usePathname } from "next/navigation";
export function NumberSwitcher({ numbers, current }: { numbers: { id: string; phoneLabel: string; status: string }[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      value={current}
      onChange={(e) => router.push(`${pathname}?sessionId=${e.target.value}`)}
      className="mb-3 w-full rounded-xl border border-border bg-surface px-3 py-2.5 text-sm shadow-sm"
      aria-label="Numero da configurare"
    >
      {numbers.map((n) => (
        <option key={n.id} value={n.id}>{n.phoneLabel} ({n.status})</option>
      ))}
    </select>
  );
}
```
  e renderizzarlo sopra il `NAV` nella sidebar.

- [ ] **Step 3: Context — `sessionId` invece di `tenantId` nel PUT.** In `src/components/settings/settings-context.tsx`:
  - Aggiungere `sessionId: string` alle props di `SettingsProvider` e al `SettingsCtx`.
  - Nel `save`, cambiare il body del PUT:
```ts
        body: JSON.stringify({ sessionId, settings: patch }),
```
  - Aggiornare la dependency list di `useCallback` da `[settings, tenantId]` a `[settings, sessionId]`.
  - Mantenere `tenantId` nel context per retrocompatibilità (alcune pagine lo usano).

- [ ] **Step 4: Typecheck + build** — `npx tsc --noEmit && npm run build` → 0 errori. Verificare che le pagine `/settings/*` che usano `useSettings()` continuino a compilare (usano `settings`/`save`/`tenantId`, tutti ancora presenti).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/settings/layout.tsx" src/components/settings/settings-shell.tsx src/components/settings/settings-context.tsx
git commit -m "feat(ui): impostazioni per-numero con selettore numero"
```

### Task 15: Setup wizard + inbox → per-numero

**Files:** Modify `src/app/(app)/setup/page.tsx`, `src/app/(app)/inbox/page.tsx`.

- [ ] **Step 1: setup/page.tsx — caricare settings del numero primario.** Sostituire `getTenantSettings(tenantId)` con la risoluzione del numero primario + `getSessionSettings`, e passare il `sessionId` al provider/wizard:
```ts
import { getSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
// ...dopo aver risolto tenantId:
  const numbers = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, status: true, createdAt: true },
  });
  const sessionId = pickPrimarySession(numbers);
  if (!sessionId) redirect("/sessions");
  const settings = await getSessionSettings(sessionId);
```
Passare `sessionId={sessionId}` al `SettingsProvider`/componente wizard (allineato alle nuove props del context, Task 14).

- [ ] **Step 2: inbox/page.tsx — settings del numero primario.** Sostituire `getTenantSettings(tenantId)` con:
```ts
import { getSessionSettings } from "@/lib/settings/session";
import { pickPrimarySession } from "@/lib/sessions/primary";
// ...
  const numbers = await db.waSession.findMany({
    where: { tenantId, deletedAt: null },
    select: { id: true, status: true, createdAt: true },
  });
  const primaryId = pickPrimarySession(numbers);
  const settings = primaryId ? await getSessionSettings(primaryId) : (await import("@/lib/settings")).parseTenantSettings(null);
```
(L'inbox usa i settings solo per dettagli di visualizzazione; il numero primario è una scelta ragionevole. Un filtro per-numero in inbox è fuori scope — vedi spec §13.)

- [ ] **Step 3: Typecheck + build** — `npx tsc --noEmit && npm run build` → 0 errori.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/setup/page.tsx" "src/app/(app)/inbox/page.tsx"
git commit -m "feat(ui): setup e inbox usano i settings del numero"
```

### Task 16: Aggiornare la guida API

**Files:** Modify `docs/API-INTEGRAZIONE.md`.

- [ ] **Step 1: Aggiornare al modello "una key per numero".** Modifiche:
  - §1: la key è **legata a un numero** scelto alla creazione in *Impostazioni → Sviluppatori*; il numero sorgente è quindi determinato dalla key.
  - §2: rimuovere ogni riferimento a un campo `from` (non esiste); chiarire che il numero sorgente è quello della key.
  - Aggiungere una breve sezione `GET /api/v1/me` → `{ sessionId, phoneLabel, status }` per sapere da che numero si invia.
  - §6 errori: aggiungere `409 number_unavailable` (key non legata a un numero valido).

- [ ] **Step 2: Commit**

```bash
git add docs/API-INTEGRAZIONE.md
git commit -m "docs: API integrazione — una key per numero + GET /api/v1/me"
```

---

## STAGE M6 — Verifica integrata + deploy staged

### Task 17: Suite, build e deploy staged con verifica E2E

- [ ] **Step 1: Suite + typecheck + build completi**

Run: `npm test && npx tsc --noEmit && npm run build`
Expected: tutti i test verdi (inclusi i nuovi `sessions-primary`, `settings-session`), 0 errori tsc, build OK.

- [ ] **Step 2: Deploy staged.** Il deploy è un'azione su **produzione con clienti reali** — eseguire SOLO con conferma dell'utente per ogni stage. Procedura per stage (M1 → M3 → M4 → M5):
  1. `git push origin main` → triggera Coolify (`migrate deploy` applica la migrazione additiva; `seed-runner` fa il backfill).
  2. Triggerare/monitorare il deploy via API Coolify (app `ewkgwc4sggw04o4888w0sw4k`) fino a `finished`, poi `/api/health` 200.
  3. Verifiche per stage:
     - **M1:** sul DB, ogni `WaSession` del tenant ha `settings` non-null; l'`AiConfig` del numero ha `sessionId`; la key di test ha `sessionId`.
     - **M3:** un messaggio in arrivo sul numero live genera ancora bozza/risposta; un job outbound rispetta cap/orari del numero; `playground` risponde.
     - **M4:** `GET /api/v1/me` (con la key di test) ritorna il numero; un invio via quella key parte dal numero giusto.
     - **M5:** in *Impostazioni* il selettore numero appare e salva sul numero selezionato; *Sviluppatori* crea una key legata a un numero scelto.

- [ ] **Step 3: Aggiornare credenziali/memoria.** In `C:\PROGETTI\CREDENZIALI_OpenWA.txt` e nella memoria di progetto: annotare il passaggio a config per-numero + key-per-numero (niente `from`; key legata a `sessionId`; cap anti-ban per numero).

- [ ] **Step 4: Commit finale (docs)**

```bash
git add -A && git commit -m "docs: per-number config LIVE" && git push origin main
```

---

## Self-Review (coverage vs spec)

- **WaSession.settings, AiConfig.sessionId, ApiKey.sessionId** → Task 1 ✓
- **Migrazione additiva idempotente + backfill (numero live, AiConfig, key)** → Task 1 (additiva) + Task 3 (backfill) ✓
- **getSessionSettings/saveSessionSettings + fallback** → Task 4 ✓
- **API key per numero (no `from`)** → Task 5 + Task 10 ✓
- **GET /api/v1/me** → Task 11 ✓
- **Creazione key con scelta numero** → Task 12 ✓
- **Pipeline inbound/outbound per-sessione** → Task 6 (reply), Task 7 (webhook), Task 8 (worker) ✓
- **Cap anti-ban per numero** → Task 8 Step 3 ✓
- **Playground per-sessione** → Task 9 ✓
- **api/settings per sessionId** → Task 13 ✓
- **UI settings con selettore numero** → Task 14 ✓
- **Setup/inbox per numero** → Task 15 ✓
- **Doc API aggiornata** → Task 16 ✓
- **Rollout staged + deploy con verifica** → Task 17 ✓
- **Tenant.settings come template di default** → coperto: `parseSettingsWithFallback` legge il tenant come fallback (Task 4); il backfill copia il tenant sul numero (Task 3). I nuovi numeri ereditano dal tenant tramite fallback finché non hanno settings propri.

**Non-coperti volutamente (YAGNI/spec §13):** self-service numeri via API, RAG per numero, provider OpenAI, metering, filtro inbox per numero.

## Note di consistenza tipi
- `ApiKeyActor` ha `sessionId: string | null` (Task 5); i consumer (`api/v1/messages`, `api/v1/me`) gestiscono il caso `null` con `409 number_unavailable`.
- `AiConfig.findUnique({ where: { sessionId } })` valido perché `sessionId` è `@unique` (Task 1).
- `pickPrimarySession` usata in: backfill (Task 3, copia inline), playground (Task 9), api/settings (Task 13), settings layout (Task 14), setup/inbox (Task 15) — stessa firma `(SessionLike[]) => string | null`.
- `getSessionSettings(sessionId)` / `saveSessionSettings(sessionId, patch)` — firma unica usata da reply, webhook, worker, playground, api/settings, settings layout, setup, inbox.
