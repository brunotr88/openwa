# OpenWA — Configurazione per-numero + API key per numero — Design

**Data:** 2026-06-14
**Stato:** approvato (brainstorming) — pronto per il piano d'implementazione

## 1. Obiettivo

Trasformare OpenWA da "un workspace = un bot con un numero" a **multi-numero**, dove:

1. Ogni **numero WhatsApp** è un **bot completo e indipendente**: ha la propria persona/identità AI,
   istruzioni, regole anti-ban (cap, ritardi, orari), modalità risposta, appuntamenti e `AiConfig`
   (provider/model/systemPrompt).
2. Chi si collega all'**API privata** sceglie il **numero sorgente** tramite la **API key**: ogni key è
   **legata a un numero** (il numero è implicito nella key, niente campo `from`). Per inviare da un altro
   numero si usa un'altra key.
3. L'**onboarding di un nuovo numero** è gestito dall'amministratore (Bruno): collega il numero (QR),
   ne configura il bot e genera la API key che consegna al cliente. Nessun self-service via API.

Il **Tenant/workspace** resta il contenitore organizzativo: utenti/operatori, elenco delle API key,
inbox aggregata, (fatturazione futura).

## 2. Decisioni di design (dal brainstorming)

- **Scope per-numero:** "Numero = bot completo" — *tutta* la configurazione è per numero, niente
  ereditarietà/override dal workspace (scelta esplicita dell'utente).
- **API key ↔ numero:** "Una key per numero" — la key determina il numero sorgente.
- **Strutturazione (Approccio A):** la configurazione vive **sul `WaSession`** (che *è* già il "numero"),
  non in una nuova entità `BotProfile`. Minimo di entità nuove, segue il pattern esistente
  (`Tenant.settings` JSON → `WaSession.settings` JSON; `AiConfig.tenantId` → `AiConfig.sessionId`).

## 3. Modello dati (modifiche Prisma)

### 3.1 `WaSession` — guadagna la configurazione
```prisma
model WaSession {
  // ...campi esistenti (id, tenantId, phoneLabel, status, sessionDataRef, lastSeenAt, createdAt, deletedAt)
  settings Json?   // TenantSettings shape (persona, behavior, hours, sending, inbox, appointments)

  aiConfig AiConfig?     // 1:1 — la config AI del numero
  apiKeys  ApiKey[]      // key legate a questo numero
  // ...relazioni esistenti (conversations, campaigns, outboundJobs)
}
```

### 3.2 `AiConfig` — da per-tenant a per-numero
```prisma
model AiConfig {
  id           String  @id @default(cuid())
  sessionId    String  @unique          // ERA: tenantId @unique
  tenantId     String                    // mantenuto per scoping/query
  provider     AiProviderType @default(BEDROCK)
  modelId      String  @default("eu.anthropic.claude-sonnet-4-5-20250929-v1:0")
  systemPrompt String?
  temperature  Float   @default(0.7)
  autoReplyEnabled Boolean @default(false)
  businessHours Json?
  updatedAt    DateTime @updatedAt

  session WaSession @relation(fields: [sessionId], references: [id])
  tenant  Tenant    @relation(fields: [tenantId], references: [id])

  @@index([tenantId])
}
```

### 3.3 `ApiKey` — legata a un numero
```prisma
model ApiKey {
  // ...campi esistenti
  sessionId String?   // numero sorgente legato alla key (nullable per migrazione, poi sempre valorizzato)
  session   WaSession? @relation(fields: [sessionId], references: [id])
}
```

### 3.4 `Tenant.settings` — deprecato
Resta nello schema come **template di default** usato alla creazione di un nuovo numero (il numero nuovo
parte copiando `Tenant.settings`, o i `recommendedDefaults` se assente). Non è più letto a runtime dalle
pipeline.

## 4. Migrazione dati (idempotente, zero downtime)

Eseguita una tantum (script di migrazione / `seed-runner` esteso), idempotente:

1. Per ogni `WaSession` non cancellata con `settings = NULL`: copia `Tenant.settings` (del suo tenant) in
   `WaSession.settings`. Così il numero live mantiene **identica** la configurazione attuale.
2. `AiConfig`: per ogni `AiConfig` esistente (oggi `@unique(tenantId)`), assegnala alla sessione
   **primaria** del tenant (la più recente CONNECTED, altrimenti la più recente) impostando `sessionId`.
   Le altre sessioni senza `AiConfig` ricevono una `AiConfig` di default.
3. `ApiKey` con `sessionId = NULL`: legala alla sessione primaria del tenant.

Vincolo d'ordine: la migrazione gira **dopo** che la colonna `WaSession.settings` e `AiConfig.sessionId`
esistono, **prima** che le pipeline inizino a leggere per-sessione. Realizzabile con una migrazione SQL
additiva + uno step di backfill idempotente nello start (`scripts/seed-runner.js`).

## 5. Modulo settings (lib/settings)

Nuove funzioni session-keyed che affiancano/rimpiazzano quelle tenant-keyed:
- `getSessionSettings(sessionId): Promise<TenantSettings>` — legge `WaSession.settings`, merge sui
  `recommendedDefaults` (riusa `parseTenantSettings`/merge esistenti). Fallback: se `settings = NULL`,
  usa `Tenant.settings` del tenant del numero, poi i default.
- `saveSessionSettings(sessionId, patch): Promise<TenantSettings>` — deep-merge + zod-validate + persist
  su `WaSession.settings` (riusa la logica di `saveTenantSettings`).

`getTenantSettings`/`saveTenantSettings` restano per il template di default del tenant ma non sono più
chiamate dalle pipeline.

## 6. API privata (key per numero)

- **`POST /api/v1/messages`**: `authenticateApiKey` ritorna anche `sessionId`. Il numero sorgente =
  `key.sessionId`. **Rimosso** `pickSession`; **non** si accetta `from`. Se la sessione legata alla key è
  cancellata/non valida → `409 { error: "number_unavailable" }`.
- **`GET /api/v1/me`** (nuovo): ritorna il numero legato alla key — `{ sessionId, phoneLabel, phone, status }`
  — così il chiamante sa da che numero invia. Auth: `X-Api-Key`.
- `GET /api/v1/messages/{jobId}`: invariato (già tenant-scoped; resta valido).
- Onboarding nuovo numero: **out-of-band** (l'admin collega+configura+genera key). Nessun errore API
  speciale "contatta admin".

## 7. Pipeline (inbound + outbound) → per-numero

Tutte le letture di config passano da `tenantId` a `sessionId`, usando il `sessionId` già presente sul
contesto:

- **`src/lib/wa/reply.ts`** (inbound AI): `getSessionSettings(conversation.sessionId)` e
  `db.aiConfig.findUnique({ where: { sessionId: conversation.sessionId } })`.
- **`src/app/api/webhooks/wa/route.ts`**: dove usa `getTenantSettings(tenantId)`, passa al `sessionId`
  della sessione che ha ricevuto l'evento.
- **`src/lib/outbound/worker.ts`**: `getSessionSettings(job.sessionId)` e
  `aiConfig.findUnique({ where: { sessionId: job.sessionId } })`. **Cap/spacing anti-ban contati per
  numero**: i conteggi `Message` filtrano su `conversation: { sessionId: job.sessionId }` invece che su
  `tenantId`. (Risolve la nota della review Fase 3: cap per-tenant → ora per-sessione, corretto.)
- **`src/app/api/playground/route.ts`**: opera sul `sessionId` selezionato (passato dalla UI).

## 8. UI Impostazioni → per-numero

- **Selettore numero**: `src/app/(app)/settings/layout.tsx` carica l'elenco numeri del tenant e il
  `sessionId` selezionato (querystring `?session=` o primo numero); carica `getSessionSettings(sessionId)`.
- **`SettingsProvider`** (`settings-context.tsx`): da `tenantId` a `sessionId` (mantiene `tenantId` per
  contesto); `save` chiama `PUT /api/settings` con `{ sessionId, settings }`.
- **`src/app/api/settings/route.ts`**: GET/PUT keyed by `sessionId` (con controllo che il numero
  appartenga a un tenant accessibile all'attore — IDOR).
- **Sviluppatori** (`/settings/sviluppatori`): alla creazione key si **sceglie il numero**; la lista key
  mostra il numero legato. `POST /api/apikeys` accetta `sessionId` (obbligatorio).
- **Setup wizard** (`/setup`): configura il numero selezionato (o il primo). Se non esiste alcun numero,
  invita prima a collegarne uno da `/sessions`.
- Stato "nessun numero": le pagine settings mostrano un empty-state che rimanda a `/sessions`.

## 9. Cosa resta a livello workspace/tenant

- Utenti/operatori e ruoli.
- Elenco aggregato delle API key (ognuna mostra il numero legato).
- **Inbox**: continua a mostrare le conversazioni di tutti i numeri del tenant, con (opzionale) filtro per
  numero. Nessun cambiamento strutturale necessario in questo spec.
- Fatturazione/metering: fuori scope (Fase 4).

## 10. Touch-points (file impattati)

- `prisma/schema.prisma` (+ migrazione) — WaSession.settings, AiConfig.sessionId, ApiKey.sessionId.
- `scripts/seed-runner.js` — backfill idempotente migrazione.
- `src/lib/settings/index.ts` — `getSessionSettings`/`saveSessionSettings`.
- `src/lib/api-auth.ts` — `authenticateApiKey` ritorna `sessionId`.
- `src/lib/wa/reply.ts`, `src/app/api/webhooks/wa/route.ts`, `src/lib/outbound/worker.ts`,
  `src/app/api/playground/route.ts` — letture per-sessione + cap per-sessione.
- `src/app/api/v1/messages/route.ts` (usa key.sessionId, no `from`) + nuovo `src/app/api/v1/me/route.ts`.
- `src/app/api/apikeys/route.ts` — `sessionId` obbligatorio in creazione.
- `src/app/api/settings/route.ts` — keyed by `sessionId`.
- `src/app/(app)/settings/layout.tsx`, `src/components/settings/settings-context.tsx`,
  `src/app/(app)/settings/sviluppatori/page.tsx`, `src/app/(app)/setup/page.tsx` — selettore numero + key-per-numero.
- `docs/API-INTEGRAZIONE.md` — aggiornata al modello "una key per numero" (niente `from`, `GET /api/v1/me`).

## 11. Testing (TDD dove possibile)

- **Funzioni pure / unit**: `getSessionSettings` con fallback (session→tenant→default); selezione sessione
  primaria nella migrazione (funzione pura `pickPrimarySession(sessions)`).
- **Migrazione**: idempotenza (eseguire due volte non duplica/riscrive) verificata su dati di esempio.
- **Pipeline/route**: typecheck + build + verifica E2E sul live (invio da una key legata a un numero;
  conferma che cap/orari del *numero* vengano applicati).
- La suite esistente (211 test) deve restare verde; gli accessi tenant-keyed sostituiti non devono
  rompere i test esistenti (aggiornarli dove testano il vecchio comportamento).

## 12. Rollout staged (ogni step deployabile, numero live mai rotto)

1. **Schema + migrazione + backfill** (additivo, compatibile: le pipeline leggono ancora il tenant finché
   non cambiate). Verifica: numero live invariato.
2. **Pipeline per-sessione** (reply/webhook/worker/playground) con fallback al tenant se
   `WaSession.settings`/`AiConfig.sessionId` mancano. Deploy + verifica inbound/outbound del numero live.
3. **API key per numero** (`authenticateApiKey` + `POST /messages` + `GET /me` + creazione key con
   sessionId). Migrazione lega la key di test al numero. Verifica invio.
4. **UI settings per-numero** (selettore numero, Sviluppatori, setup). Verifica configurazione.
5. **Cleanup**: rimozione dei rami di fallback al tenant una volta che tutti i numeri hanno config propria.

## 13. Non-obiettivi (YAGNI per questo spec)

- Self-service di collegamento numeri via API (resta manuale lato admin).
- Knowledge base / RAG per numero (è Fase 2; il modello per-numero la anticipa ma non la implementa qui).
- Provider OpenAI (Fase 4).
- Metering/fatturazione per numero.
- Filtro inbox per numero (opzionale, non bloccante).

## 14. Rischi

- Refactor ampio (~12 file) + migrazione su DB di produzione con conversazioni reali. Mitigazione:
  migrazione additiva e idempotente, rollout staged con fallback al tenant, il numero live mantiene la
  config copiata identica.
- `AiConfig` passa da `@unique(tenantId)` a `@unique(sessionId)`: la migrazione deve garantire che ogni
  sessione abbia al più una AiConfig prima di applicare il vincolo unico.
