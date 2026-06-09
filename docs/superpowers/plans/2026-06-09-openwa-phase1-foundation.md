# OpenWA Fase 1 — Foundation + Inbound MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Avere a `https://openwa.isipc.com` una piattaforma deployata che riceve messaggi WhatsApp (1 numero via open-wa), li mostra in un'inbox web autenticata, e risponde con l'AI (Bedrock) in modalità AUTO o COPILOT — schema dati già multi-tenant.

**Architecture:** Due servizi sullo stesso Coolify project `OpenWA`: `openwa-web` (Next.js 15 standalone, stack blueprint) e `openwa-gateway` (worker Node + Chromium con open-wa). Bus = Postgres (pgvector) + HTTP interno con Bearer condiviso. Riferimento completo: `docs/superpowers/specs/2026-06-09-openwa-platform-design.md` e `C:\PROGETTI\BLUEPRINT_isipc_webapp.md`.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Prisma 6, PostgreSQL 16 + pgvector, NextAuth v5, Tailwind 3 + shadcn/ui, @open-wa/wa-automate, @aws-sdk/client-bedrock-runtime, Docker multi-stage, Coolify.

**Infra già creata (vedi `C:\PROGETTI\CREDENZIALI_OpenWA.txt`):**
- Coolify project `OpenWA` = `dsg8g40s0ccko4kco8gkss8k`, server `q8ww8o88kkskogccck48o44k`
- Postgres `pgvector/pgvector:pg16` = `jck8gw88c8c4sggk84440wk4`
- DNS `openwa.isipc.com` → attivo

---

## File Structure (Fase 1)

```
openwa/                              ← repo root (GitHub brunotr88/openwa)
├── prisma/
│   ├── schema.prisma                ← modelli Fase 1 (Tenant,User,UserTenant,WaSession,Contact,Conversation,Message,AiConfig,AuditLog) + vector
│   ├── seed.ts                      ← admin + tenant demo idempotente
│   └── migrations/…_init/migration.sql  ← include CREATE EXTENSION vector
├── public/.gitkeep                  ← OBBLIGATORIO per Docker COPY
├── scripts/{start.sh,seed-runner.js}
├── src/
│   ├── app/
│   │   ├── login/                   ← public
│   │   ├── (app)/{layout.tsx,inbox/,sessions/,settings/ai/}
│   │   └── api/{auth/[...nextauth]/route.ts,health/route.ts,internal/generate-reply/route.ts}
│   ├── components/{ui/,app/}
│   ├── lib/
│   │   ├── auth.ts, auth.config.ts, db.ts, crypto.ts, mailer.ts, audit.ts, rate-limit.ts, validators.ts, utils.ts
│   │   ├── tenancy.ts               ← accessibleTenantIds()
│   │   ├── ai/{provider.ts,bedrock.ts,index.ts}   ← interfaccia + Bedrock + factory
│   │   └── wa/client.ts             ← chiamate HTTP al gateway
│   └── middleware.ts
├── gateway/                         ← Servizio B
│   ├── src/{index.ts,engine.ts,openwa-engine.ts,inbound.ts,outbound.ts,http.ts,db.ts}
│   ├── Dockerfile                   ← node + chromium deps
│   └── package.json
├── Dockerfile                       ← Next standalone (web)
├── .env.example                    ← solo placeholder generici (blueprint §11.2)
├── .gitleaks.toml, .githooks/pre-commit
├── next.config.mjs, tailwind.config.ts, tsconfig.json, package.json
└── README.md
```

---

## Milestone M1 — Repo + scaffold buildabile

### Task 1: Init repo + gitleaks (blueprint §11.1, PRIMA del primo commit)
**Files:** Create `.githooks/pre-commit`, `.gitleaks.toml`, `.gitignore`, `README.md`

- [ ] **Step 1:** `cd /mnt/c/PROGETTI/SOFTWARES/OpenWA && git init`
- [ ] **Step 2:** Installa gitleaks se assente (blueprint §11.1 comandi) e crea `.githooks/pre-commit` + `.gitleaks.toml` (copia esatta da blueprint §11.1).
- [ ] **Step 3:** `git config core.hooksPath .githooks`
- [ ] **Step 4:** `.gitignore` con `node_modules`, `.env*` (tranne `.env.example`), `.next`, `gateway/sessions/`, `*.tmp`.
- [ ] **Step 5:** Commit `chore: init repo + gitleaks guard`.

### Task 2: package.json + toolchain web
**Files:** Create `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`
- [ ] Dipendenze runtime (NON dev): `next@15`, `react`, `prisma`, `@prisma/client`, `next-auth@beta`, `bcryptjs`, `zod`, `nodemailer`, `otpauth`, `qrcode`, `@aws-sdk/client-bedrock-runtime`, `lucide-react`, `tailwind-merge`, `clsx`.
- [ ] `prisma` in **dependencies** (blueprint insidia). `next.config.mjs` con `output:"standalone"` + security headers (blueprint §3 headers).
- [ ] Commit `chore: web toolchain`.

### Task 3: Prisma schema Fase 1 + migration init (con pgvector)
**Files:** Create `prisma/schema.prisma`, `prisma/migrations/<ts>_init/migration.sql`, `prisma/migrations/migration_lock.toml`
- [ ] Modelli: Tenant, User, UserTenant, WaSession, Contact, Conversation, Message, AiConfig, AuditLog (campi da spec §3). `Contact.profileSummary` String?. enums come da spec.
- [ ] Genera migration init senza DB live (blueprint §6 comando `prisma migrate diff`). **Aggiungi a mano in cima al migration.sql:** `CREATE EXTENSION IF NOT EXISTS vector;`
- [ ] **Test:** build locale Prisma `npx prisma validate` → ok. Commit `feat: prisma schema fase 1`.

### Task 4: lib core (db, crypto, auth, tenancy, audit, utils)
**Files:** Create `src/lib/{db.ts,crypto.ts,auth.ts,auth.config.ts,tenancy.ts,audit.ts,utils.ts,validators.ts,rate-limit.ts,mailer.ts}`, `src/middleware.ts`
- [ ] Copia pattern blueprint §3 (crypto AES-256-GCM no fallback; auth bcrypt+lockout+TOTP; auth.config edge-safe; audit fire-and-forget).
- [ ] `tenancy.ts`: `accessibleTenantIds(userId, isGlobalAdmin)` (pattern blueprint §12.2).
- [ ] **Test (TDD):** `tests/crypto.test.ts` round-trip encrypt/decrypt; `tests/tenancy.test.ts` filtro. Run → pass. Commit.

### Task 5: AI adapter (interfaccia + Bedrock)
**Files:** Create `src/lib/ai/provider.ts`, `src/lib/ai/bedrock.ts`, `src/lib/ai/index.ts`, `tests/ai-bedrock.test.ts`
- [ ] `provider.ts`: interfaccia `AiProvider` (spec §4).
- [ ] `bedrock.ts`: `BedrockProvider` usa `BedrockRuntimeClient` + `ConverseCommand`, region da `BEDROCK_REGION`, modelId = inference profile `eu.*`, credenziali da env `BEDROCK_ACCESS_KEY_ID/SECRET`.
- [ ] `index.ts`: factory `getProvider(aiConfig)` → BEDROCK|OPENAI(throw not-impl).
- [ ] **Test:** mock `@aws-sdk/client-bedrock-runtime`, verifica che `generate()` mappi messages→Converse e ritorni `{text,usage}`. Run → pass. Commit.

### Task 6: Dockerfile web + .env.example + health route
**Files:** Create `Dockerfile`, `.dockerignore`, `.env.example`, `src/app/api/health/route.ts`, `scripts/start.sh`, `scripts/seed-runner.js`, `public/.gitkeep`
- [ ] Dockerfile multi-stage (blueprint §5: full `node_modules` copy, `apk add wget curl`). `start.sh`: migrate deploy → seed → next start.
- [ ] `.env.example` SOLO placeholder generici (blueprint §11.2 — gitleaks deve passare).
- [ ] `/api/health` ritorna `"ok"`/503 minimale.
- [ ] **Test:** build locale con env dummy (blueprint §6) → compila. Commit.

### Task 7: Push GitHub + crea app Coolify + deploy skeleton
- [ ] Crea repo pubblico `brunotr88/openwa`, push `main`.
- [ ] Via API Coolify (blueprint §2.5): crea app `openwa-web` (build_pack dockerfile, ports 3000, domain `https://openwa.isipc.com`), aggiungi env (DATABASE_URL interno, ENCRYPTION_KEY, NEXTAUTH_SECRET/URL, BEDROCK_*, INTERNAL_GATEWAY_SECRET, SMTP, TZ, ADMIN_*), PATCH healthcheck `/api/health`, deploy.
- [ ] **Verifica:** `curl https://openwa.isipc.com/api/health` → `ok`; cert SSL non-default (blueprint §7). Commit eventuali fix.

---

## Milestone M2 — Gateway open-wa (1 sessione, QR)

### Task 8: Gateway scaffold + engine interface
**Files:** Create `gateway/package.json`, `gateway/src/{index.ts,engine.ts,db.ts,http.ts}`, `gateway/Dockerfile`
- [ ] `engine.ts`: interfaccia `WaEngine` (spec §5). `http.ts`: Express minimale con Bearer `INTERNAL_GATEWAY_SECRET` (`timingSafeEqual`), endpoint `/session/start`,`/session/stop`,`/session/:id/qr`,`/send`.
- [ ] `db.ts`: Prisma client (riusa stesso schema; gateway dipende da `@prisma/client` generato — o package condiviso). **Test:** auth Bearer timing-safe. Commit.

### Task 9: OpenWaEngine (open-wa/wa-automate)
**Files:** Create `gateway/src/openwa-engine.ts`, `gateway/src/inbound.ts`
- [ ] `OpenWaEngine` implementa `WaEngine`: `create()` con `sessionDataPath` su volume, emette QR → salva in memoria/DB, `onMessage` → `inbound.ts`.
- [ ] `inbound.ts`: upsert Contact/Conversation + crea `Message(IN)`; se `Conversation.mode==AUTO` && config → chiama web `/api/internal/generate-reply`.
- [ ] **Test:** engine mock per inbound→DB (no Chromium nei test). Commit.

### Task 10: Dockerfile gateway + deploy + volume
- [ ] Dockerfile con deps Chromium (`chromium`, fonts, `PUPPETEER_EXECUTABLE_PATH`). Crea app Coolify `openwa-gateway` (no dominio), **volume persistente** `/app/sessions`, env condivise. Deploy.
- [ ] **Verifica:** log gateway "ready"; healthcheck processo. UI `sessions/` mostra QR; scan reale → `WaSession.status=CONNECTED`. Commit.

---

## Milestone M3 — Inbox + auto-reply

### Task 11: generate-reply route (web)
**Files:** Create `src/app/api/internal/generate-reply/route.ts`, `src/lib/conversation.ts`
- [ ] Auth Bearer interno. Carica storico (ultimi N) + `AiConfig` + `Contact.profileSummary` → `getProvider().generate()`.
- [ ] AUTO → `Message(OUT,QUEUED)` + invio immediato via `wa/client.ts` `/send`. COPILOT → `Message(OUT,DRAFT)`.
- [ ] **Test:** mock provider + db, verifica branch AUTO vs COPILOT. Commit.

### Task 12: Inbox UI
**Files:** Create `src/app/(app)/inbox/{page.tsx,conversation-view.tsx,reply-box.tsx}`, `src/app/(app)/settings/ai/page.tsx`
- [ ] Lista conversazioni (filtrate `accessibleTenantIds`), thread messaggi, toggle mode AUTO/COPILOT/MANUAL, approva/modifica DRAFT (client component — no onClick in RSC, blueprint §12.1).
- [ ] Settings AI: provider, modelId, systemPrompt, temperature, autoReplyEnabled, businessHours.
- [ ] **Test:** server action guard tenant; render thread. Commit.

### Task 13: profileSummary periodico + polling inbox
- [ ] Aggiorna `Contact.profileSummary` ogni N messaggi (riassunto LLM). Inbox polling con AbortController (blueprint §12.9).
- [ ] **Verifica end-to-end:** messaggio WA reale → appare in inbox → AI risponde (AUTO) / bozza (COPILOT). `code-reviewer` agent. Commit.

---

## Self-Review note
- Copertura spec §1–§12 (Fase 1 subset): schema (T3) ✓, adapter AI (T5) ✓, engine (T8-9) ✓, modalità (T11-12) ✓, memoria-contatto base (T13) ✓, sicurezza (T1,T4) ✓, deploy 2 servizi (T7,T10) ✓. RAG/correzioni/outbound-API = Fase 2-3 (fuori da questo plan).
- Anti-ban completo, API privata, multi-sessione, OpenAI = milestone fasi successive.
