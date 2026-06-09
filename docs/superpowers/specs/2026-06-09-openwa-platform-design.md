# OpenWA — Design / Spec

> Data: 2026-06-09
> Dominio: **openwa.isipc.com** (CNAME → isipc.duckdns.org → 188.216.247.160)
> Stack: blueprint ISIPC su Coolify (vedi `C:\PROGETTI\BLUEPRINT_isipc_webapp.md`)
> Bedrock: `C:\PROGETTI\SOFTWARES\AWSAmazon\BEDROCK_AI_COMPLETE_GUIDE.md` (IAM `bedrock-invoker`, region `eu-central-1`)

---

## 1. Visione

Piattaforma **SaaS multi-tenant** che collega numeri WhatsApp ad AI configurabili per:
gestione inbox condivisa, **auto-risposta AI**, **co-pilot** umano (AI suggerisce, umano approva),
**campagne** in uscita, e una **API privata** che permette ad altre applicazioni di far inviare
messaggi WhatsApp a contatti specifici. La piattaforma "impara" tramite **RAG (knowledge base)**,
**memoria delle correzioni** del co-pilot e **memoria per contatto**.

### Decisioni chiave (confermate in brainstorming)
| Tema | Decisione |
|---|---|
| Scopo | Piattaforma completa (inbox + auto-reply + co-pilot + campagne + KB) |
| Apprendimento | RAG + memoria correzioni + memoria per contatto (NO fine-tuning) |
| Provider AI | **AWS Bedrock** + **OpenAI** prioritari; adapter pluggabile (Claude/Gemini/Groq aggiungibili: chiavi già presenti) |
| Multi-tenant | Sì, per clienti (isolamento dati completo) |
| API privata | Sì — accetta **testo diretto / template+variabili / intento (AI compone)**, flessibile |
| Motore WhatsApp | **open-wa** (scelta utente, rischio-ban noto) — dietro interfaccia astratta per swap futuro a Cloud API |
| Architettura | **Opzione A**: due servizi (Next.js + Gateway worker) + coda su Postgres |

### ⚠️ Rischio noto e accettato
open-wa usa l'API **non ufficiale** di WhatsApp Web. L'outbound automatico multi-tenant è il pattern
più esposto al **ban dei numeri** (propri e dei clienti). Mitigazioni anti-ban sono feature di prima
classe (vedi §7). Il motore è dietro interfaccia `WaEngine` per consentire switch a **WhatsApp Cloud API**
(ufficiale) senza riscrivere la logica applicativa.

---

## 2. Vincolo architetturale e topologia servizi

open-wa richiede un **Chromium headless sempre acceso e loggato**, una sessione per numero (QR da
scansionare, token sessione persistente). Questo **non può vivere nel ciclo di vita di Next.js**.
Quindi due servizi distinti:

### Servizio A — `openwa-web` (Next.js 15, stack blueprint)
- Dashboard (inbox, contatti, config AI, knowledge base, campagne, sessioni WA)
- API REST interna (NextAuth) + **API privata `/api/v1/*`** (auth API-key)
- Logica AI (`src/lib/ai/`), retrieval RAG, riduzione storico→prompt
- Client verso il Gateway (`src/lib/wa/`)
- Stateless, dominio pubblico `https://openwa.isipc.com`

### Servizio B — `openwa-gateway` (worker Node long-running)
- Una istanza open-wa per `WaSession` connessa; token su **volume persistente**
- Inbound: scrive `Message(IN)` in Postgres, innesca generazione risposta se AUTO
- Outbound: consuma `OutboundJob` con **throttling anti-ban**
- Endpoint interno (rete privata Coolify, Bearer condiviso): start/stop sessione, get QR, send immediato
- **Nessun dominio pubblico**

### Bus di comunicazione A↔B
- **Postgres come bus principale** (tabelle `Message`, `OutboundJob`) — polling dal gateway
- **HTTP interno** per azioni sincrone (QR, comandi sessione, generate-reply)
- Nessun Redis in Fase 1 (evoluzione a BullMQ/Redis = Opzione C quando l'outbound scala)

### Dati
- **PostgreSQL 16** con estensione **pgvector** (image `pgvector/pgvector:pg16`)
- Embeddings RAG via **Bedrock Titan** `amazon.titan-embed-text-v2:0`

---

## 3. Modello dati (Prisma)

> Multi-tenant dalla Fase 1. Ogni query filtra per `accessibleTenantIds` (blueprint §12.2).
> Soft-delete via `deletedAt` su entità FK-linked (blueprint §12.5).

```
Tenant         id, name, slug, status, createdAt, deletedAt
User           id, email, passwordHash, name, role(ADMIN|OPERATOR|VIEWER),
               failedAttempts, lockedUntil, totpSecret, createdAt
UserTenant     id, userId, tenantId, role            // accesso multi-tenant
WaSession      id, tenantId, phoneLabel, status(QR|CONNECTED|BANNED|OFFLINE),
               sessionDataRef, lastSeenAt, createdAt, deletedAt
Contact        id, tenantId, waId, name, profileSummary, optInStatus(IN|OUT|UNKNOWN),
               tags[], createdAt, deletedAt
Conversation   id, tenantId, contactId, sessionId, mode(AUTO|COPILOT|MANUAL),
               status(OPEN|SNOOZED|CLOSED), lastMessageAt, assignedUserId, deletedAt
Message        id, conversationId, tenantId, direction(IN|OUT), body, mediaRef,
               status(RECEIVED|DRAFT|QUEUED|SENT|DELIVERED|READ|FAILED),
               aiGenerated, source(WA|API|CAMPAIGN), createdAt
AiConfig       id, tenantId, provider(BEDROCK|OPENAI), modelId, systemPrompt,
               temperature, autoReplyEnabled, businessHours(json), updatedAt
KnowledgeDoc   id, tenantId, title, sourceType, status, createdAt, deletedAt       // Fase 2
KnowledgeChunk id, docId, tenantId, content, embedding(vector(1024))               // Fase 2
Correction     id, tenantId, conversationId, aiDraft, finalText,
               contextEmbedding(vector(1024)), createdAt                          // Fase 2
OutboundJob    id, tenantId, contactId, sessionId, mode(TEXT|TEMPLATE|INTENT),
               payload(json), scheduledAt, attempts, status(PENDING|SENDING|DONE|FAILED),
               createdAt                                                          // Fase 3
ApiKey         id, tenantId, hashedKey, label, scopes[], lastUsedAt, createdAt, deletedAt // Fase 3
AuditLog       id, userId, tenantId, action, entity, entityId, meta(json), ip, userAgent, createdAt
```

Indici: `@@unique([tenantId, waId])` su Contact; `@@index([status, scheduledAt])` su OutboundJob;
indice HNSW su `embedding` (pgvector) per KnowledgeChunk/Correction.

---

## 4. Adapter AI (selezione provider)

```ts
interface AiProvider {
  generate(input: {
    system: string;
    messages: ChatMsg[];     // storico conversazione (ridotto)
    context?: string;         // RAG + correzioni iniettate (Fase 2)
    temperature?: number;
    modelId: string;
  }): Promise<{ text: string; usage: TokenUsage }>;
  embed?(texts: string[]): Promise<number[][]>;   // RAG (Titan)
}
```

- `BedrockProvider` — Converse API, region `eu-central-1`, **inference profile `eu.*`** (es.
  `eu.anthropic.claude-sonnet-4-5-20250929-v1:0`, `eu.amazon.nova-lite-v1:0`). Credenziali IAM
  `bedrock-invoker` via env. Embeddings `amazon.titan-embed-text-v2:0`.
- `OpenAIProvider` — Fase 4 (richiede chiave da aggiungere).
- Selezione per-tenant da `AiConfig`. Aggiungere un provider = nuova classe che implementa
  l'interfaccia, **zero refactor** del resto.

---

## 5. Motore WhatsApp (astratto)

```ts
interface WaEngine {
  startSession(sessionId: string): Promise<{ qr?: string; status: WaStatus }>;
  stopSession(sessionId: string): Promise<void>;
  sendText(sessionId: string, waId: string, text: string): Promise<{ ack: string }>;
  sendMedia(sessionId: string, waId: string, media: MediaRef): Promise<{ ack: string }>;
  onMessage(handler: (msg: InboundMsg) => Promise<void>): void;
  onStatusChange(handler: (sessionId: string, status: WaStatus) => void): void;
}
```
Implementazione Fase 1: `OpenWaEngine` (open-wa/wa-automate). Futuro: `CloudApiEngine`.

---

## 6. Flussi

### Pairing numero
UI "Aggiungi numero" → app crea `WaSession(status=QR)` → `POST gateway /session/start` →
open-wa emette QR base64 → UI lo mostra (polling) → scan utente → `status=CONNECTED`.

### Inbound
```
open-wa onMessage → Gateway: upsert Contact/Conversation + Message(IN)
  AUTO    → POST app /api/internal/generate-reply { conversationId }
            app: storico + (F2) RAG + correzioni → AiProvider.generate()
                 → Message(OUT, QUEUED) → OutboundJob
  COPILOT → app genera Message(OUT, DRAFT); operatore approva/modifica in UI
            (ogni modifica → Correction, Fase 2)
  MANUAL  → nessuna azione AI
```

### Outbound
Gateway consuma `OutboundJob` PENDING (rispettando `scheduledAt` + throttle) →
`sendText/sendMedia` → update `Message.status` → ack. Retry con backoff su FAILED (max attempts).

### API privata (Fase 3)
`POST /api/v1/messages` (auth: header `X-Api-Key`, `timingSafeEqual` su hash):
```jsonc
{
  "to": "+39...",                  // o contactId
  "mode": "text|template|intent",
  "text": "...",                   // se text
  "templateId": "...", "vars": {}, // se template
  "intent": "...", "context": {},  // se intent → AI compone con tono brand + memoria contatto
  "scheduledAt": "ISO8601?"        // opzionale
}
```
→ valida opt-in/throttle → crea `OutboundJob`. Risposta `202 { jobId }`. Scope per API key.

---

## 7. Anti-ban (prima classe — scelta open-wa)
- Delay randomizzato tra invii (es. 8–25s), cap giornaliero per sessione, **warm-up** progressivo per numeri nuovi
- Invio **solo** a contatti `optInStatus=IN` o che hanno scritto per primi
- Quiet hours / business hours rispettati
- Rilevazione `status=BANNED` → stop invii + alert UI + notifica email (blueprint mailer)
- Coda con pacing globale per sessione (non solo per job)

---

## 8. Modalità risposta
- **AUTO** — AI invia da sola; guardrail: orari, opt-in, soglia di incertezza → escalation a umano
- **COPILOT** — AI bozza, operatore approva/modifica (→ `Correction`)
- **MANUAL** — solo umano

Default per tenant in `AiConfig`; override per conversazione (`Conversation.mode`).

---

## 9. Apprendimento
- **Fase 1:** storico messaggi nel prompt + `Contact.profileSummary` (riassunto LLM periodico delle preferenze)
- **Fase 2:** RAG — doc → chunk → Titan embed → pgvector → top-k nel `context`;
  Correction store — similarity search sulle bozze corrette → few-shot nel prompt

---

## 10. Sicurezza (blueprint §11–13, obbligatori)
- gitleaks pre-commit + `.gitleaks.toml` prima del primo commit
- AES-256-GCM at-rest per token sessione WA e hash API key
- NextAuth: bcrypt cost 12, lockout 5/15min, TOTP, JWT 8h HttpOnly/SameSite=Lax/Secure
- `timingSafeEqual` su Bearer interno A↔B e su API key
- IDOR: `accessibleTenantIds` su **ogni** route `/[id]`
- `auditLog()` fire-and-forget su mutazioni e invii
- Soft-delete via `deletedAt`; headers sicurezza in `next.config.mjs`; `/api/health` minimale
- `.env.example` solo placeholder generici (no infra reale)

---

## 11. Deploy Coolify (2 applicazioni, stesso project)
- Project `OpenWA`; Postgres `pgvector/pgvector:pg16` (privato)
- App `openwa-web` (Dockerfile Next standalone) → `https://openwa.isipc.com`
  - Pre-deploy: CNAME `openwa.isipc.com → isipc.duckdns.org`; verifica DNS `dig @8.8.8.8`
- App `openwa-gateway` (Dockerfile Node + Chromium/Puppeteer deps, **volume persistente** sessioni) → rete interna, no dominio
- Env: `DATABASE_URL`, `BEDROCK_ACCESS_KEY_ID`/`BEDROCK_SECRET_ACCESS_KEY`/`BEDROCK_REGION=eu-central-1`,
  `ENCRYPTION_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `INTERNAL_GATEWAY_SECRET`, `GATEWAY_URL`,
  SMTP standard, `TZ=Europe/Rome`, `ADMIN_*` seed
- Healthcheck `/api/health` su web; healthcheck processo su gateway

---

## 12. Testing
- TDD logica: adapter AI (mock), throttle/pacing, guard multi-tenant (`accessibleTenantIds`),
  auth API-key, riduzione storico→prompt, builder messaggio (text/template/intent)
- Gateway/open-wa: integrazione con engine mock; smoke manuale col QR reale
- `code-reviewer` pre-deploy (severità + file:linea), checklist pre-PR blueprint §13

---

## 13. Fasi (ognuna = proprio ciclo spec→plan→implement)

1. **Fondamenta + Inbound MVP** — scaffold blueprint, deploy `openwa.isipc.com`, Postgres+pgvector,
   `openwa-gateway` con open-wa (1 sessione, QR in UI), inbox, `BedrockProvider`, auto-reply
   AUTO/COPILOT, memoria-contatto base (storico). **← questo spec dettaglia la Fase 1.**
2. **Apprendimento** — RAG knowledge base (upload → Titan → pgvector), memoria correzioni, profilo-contatto sintetizzato.
3. **Outbound + API privata** — API key per tenant, coda `OutboundJob` + throttling anti-ban,
   endpoint text/template/intent, campagne UI.
4. **Multi-tenant + productization** — isolamento completo, sessioni multiple, `OpenAIProvider` +
   switch provider in UI, metering uso, billing (opzionale).

---

## 14. Non-obiettivi (YAGNI per ora)
- Fine-tuning di modelli custom
- Redis/BullMQ in Fase 1 (coda su Postgres basta)
- WhatsApp Cloud API (solo seam d'astrazione predisposto)
- OpenAI provider prima della Fase 4
- Billing/fatturazione automatica (valutare in Fase 4)
