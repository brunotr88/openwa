# OpenWA — Pacchetto di integrazione API (per Claude / agenti AI)

> **Cos'è questo file:** un pacchetto self-contained per integrare l'API di OpenWA in un altro
> progetto. Dallo a un agente AI (Claude) insieme alla richiesta "integra l'invio di messaggi
> WhatsApp con OpenWA" e ha già tutto: config, endpoint, schemi, client pronti da incollare.
> **OpenWA** è una piattaforma che invia messaggi WhatsApp tramite un numero reale, con coda e
> protezioni anti‑ban.

---

## 0. ISTRUZIONI PER L'AGENTE (leggere per primo)

Per collegare questo progetto a OpenWA ti serve **una sola cosa dall'utente**: una **API key**
(formato `owa_live_...`). Tutto il resto è in questo file.

**Prima di scrivere codice, chiedi all'utente:**
1. La **API key** (`owa_live_...`). Se non ce l'ha: si crea in OpenWA → *Impostazioni → Sviluppatori →
   scegli il numero mittente → Crea key* (mostrata una sola volta). **La key determina già il numero
   WhatsApp da cui si invia** — non serve specificare il numero nelle richieste.
2. (Opzionale) Il **Base URL**, se diverso da `https://openwa.isipc.com`.

**Poi:**
- Salva la key come **variabile d'ambiente lato server** `OPENWA_API_KEY` (mai nel frontend/codice
  pubblico).
- Fai lo **smoke test** della §6 (`GET /api/v1/me`) per confermare che la key è valida e vedere da
  quale numero invia.
- Incolla il **client** della §5 (TypeScript o Python) e usalo.
- Gestisci i 3 punti della §4 (consegna asincrona, opt‑in, errori). Sono l'unica logica non banale.

Quando hai la key e lo smoke test passa, **sei collegato**. Niente altri step.

---

## 1. Configurazione

| Variabile | Valore | Note |
|---|---|---|
| `OPENWA_API_KEY` | `owa_live_...` | Segreta, solo lato server. Determina il numero mittente. |
| `OPENWA_BASE_URL` | `https://openwa.isipc.com` | Default; sovrascrivibile. |

- **Autenticazione:** header `X-Api-Key: <OPENWA_API_KEY>` su ogni richiesta.
- **Formato:** JSON (`Content-Type: application/json`).
- **Una key = un numero.** Per inviare da numeri diversi servono key diverse (una per numero).

---

## 2. Il modello in 30 secondi

1. Chiami `POST /api/v1/messages` con destinatario + messaggio → ricevi **subito** `202 { jobId }`.
   Il `202` = *accettato e messo in coda*, **non** *consegnato*.
2. OpenWA invia in modo **asincrono** rispettando l'anti‑ban (coda ~1 msg/min per numero, orari di
   lavoro, cap giornalieri). Può quindi essere **differito** (es. fuori orario → parte al prossimo
   orario lavorativo).
3. Controlli la consegna con `GET /api/v1/messages/{jobId}` (polling) finché `status` = `DONE` o `FAILED`.
4. **Consegna at‑most‑once:** in caso di interruzione ambigua un job diventa `FAILED` e **non** viene
   re‑inviato in automatico (nessun doppione a sorpresa) — decidi tu se ritentare.

---

## 3. Endpoint

### 3.1 `POST /api/v1/messages` — accoda un invio

**Headers:** `X-Api-Key`, `Content-Type: application/json`.

**Body:**

| Campo | Tipo | Obblig. | Descrizione |
|---|---|---|---|
| `to` | string | sì | Destinatario in formato internazionale, es. `+393331234567`. |
| `mode` | `text` \| `template` \| `intent` | sì | Come si compone il messaggio. |
| `text` | string | se `mode=text` | Testo esatto (max 4096 char). |
| `templateId` | string | se `mode=template` | ID di un template creato in OpenWA. |
| `vars` | object | no | Variabili del template. `{{nome}}` è auto‑compilato dal contatto. |
| `intent` | string | se `mode=intent` | Istruzione per l'AI, che **compone** il messaggio col tono del numero. |
| `context` | object | no | Dati extra per `intent`, es. `{ "ordine": "A-1024" }`. |
| `optIn` | boolean | no | `true` = dichiari di avere il **consenso** (necessario per numeri nuovi, vedi §4). |
| `scheduledAt` | string ISO‑8601 | no | Invio programmato; rispetta comunque orari/anti‑ban. |

**Risposta `202`:** `{ "jobId": "...", "status": "PENDING" }`

### 3.2 `GET /api/v1/messages/{jobId}` — stato di un invio

**Headers:** `X-Api-Key`.
**Risposta `200`:**
```json
{
  "id": "cmq...",
  "status": "DONE",
  "mode": "TEXT",
  "attempts": 0,
  "lastError": null,
  "messageId": "cmq...",
  "scheduledAt": null,
  "sentAt": "2026-06-15T08:01:22.000Z",
  "createdAt": "2026-06-15T08:00:00.000Z",
  "messageStatus": "SENT"
}
```
- `status`: `PENDING` (in coda) → `SENDING` → `DONE` (inviato) / `FAILED` / `CANCELED`.
- `messageStatus` (dopo l'invio): `SENT` / `DELIVERED` / `READ` / `FAILED`.
- `lastError`: motivo se `FAILED`/differito (es. `outside_hours`, `opt_in`, `expired`).

### 3.3 `GET /api/v1/me` — da che numero invii

**Headers:** `X-Api-Key`.
**Risposta `200`:** `{ "sessionId": "...", "phoneLabel": "ISIPC principale", "status": "CONNECTED", "scopes": ["messages:send"] }`
Usalo come **smoke test** e per mostrare/validare il numero mittente nel tuo progetto.

---

## 4. Le 3 cose che il tuo codice DEVE gestire

1. **Consegna asincrona.** Tratta l'invio come *accettato*, non *consegnato*. Salva il `jobId` sul
   record e aggiorna lo stato via polling (§3.2), o mostra "in coda / inviato / non riuscito". La
   consegna può richiedere minuti o attendere l'orario lavorativo.
2. **Consenso (opt‑in).** OpenWA invia **solo** a contatti che hanno già scritto al numero **oppure**
   per cui passi `"optIn": true` (con cui dichiari di avere un consenso valido — il tuo sistema è la
   fonte di verità del consenso). Numero nuovo senza `optIn` → `403 opt_in_required`.
3. **Errori.** Gestisci `403 opt_in_required` (passa `optIn:true` se hai il consenso),
   `409 number_unavailable` (key non legata a un numero valido → avvisa l'admin OpenWA),
   `401 unauthorized` (key errata), e `5xx` con backoff. Tabella completa in §7.

> **Nessuna deduplica automatica:** due richieste identiche = due messaggi. Se ti serve idempotenza,
> gestiscila tu (es. non re‑inviare se esiste già un `jobId` per quel record).

---

## 5. Client pronti da incollare

### 5.1 TypeScript / Node (fetch nativo, Node 18+)
```ts
// openwa.ts — client minimale per l'API OpenWA. Usa solo lato server.
const BASE = process.env.OPENWA_BASE_URL ?? "https://openwa.isipc.com";
const KEY = process.env.OPENWA_API_KEY;
if (!KEY) throw new Error("OPENWA_API_KEY mancante");

type Mode = "text" | "template" | "intent";

export interface SendInput {
  to: string;                       // "+39..."
  mode: Mode;
  text?: string;                    // mode=text
  templateId?: string;              // mode=template
  vars?: Record<string, string>;    // mode=template
  intent?: string;                  // mode=intent
  context?: Record<string, unknown>;// mode=intent
  optIn?: boolean;                  // consenso per numeri nuovi
  scheduledAt?: string;             // ISO-8601, opzionale
}

export interface JobStatus {
  id: string;
  status: "PENDING" | "SENDING" | "DONE" | "FAILED" | "CANCELED";
  mode: string;
  attempts: number;
  lastError: string | null;
  messageId: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  messageStatus: string | null;
}

async function call(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "X-Api-Key": KEY!, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

/** Da quale numero invia questa key (smoke test). */
export async function whoAmI() {
  const r = await call("/api/v1/me");
  if (!r.ok) throw new Error(`OpenWA /me ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data as { sessionId: string; phoneLabel: string; status: string; scopes: string[] };
}

/** Accoda un invio. Ritorna il jobId (202). Lancia con dettaglio su errore. */
export async function sendMessage(input: SendInput): Promise<{ jobId: string }> {
  const r = await call("/api/v1/messages", { method: "POST", body: JSON.stringify(input) });
  if (r.status === 202) return r.data as { jobId: string };
  // errori tipici: 403 opt_in_required, 409 number_unavailable, 400 invalid body, 401 unauthorized
  throw new Error(`OpenWA send ${r.status}: ${JSON.stringify(r.data)}`);
}

/** Stato di un invio. */
export async function getStatus(jobId: string): Promise<JobStatus> {
  const r = await call(`/api/v1/messages/${jobId}`);
  if (!r.ok) throw new Error(`OpenWA status ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data as JobStatus;
}

/** Comodità: invia e aspetta l'esito (polling). Default ~10 min. */
export async function sendAndWait(input: SendInput, opts: { tries?: number; everyMs?: number } = {}) {
  const { jobId } = await sendMessage(input);
  const tries = opts.tries ?? 20, everyMs = opts.everyMs ?? 30_000;
  for (let i = 0; i < tries; i++) {
    const s = await getStatus(jobId);
    if (s.status === "DONE" || s.status === "FAILED" || s.status === "CANCELED") return s;
    await new Promise((r) => setTimeout(r, everyMs));
  }
  return getStatus(jobId); // ancora in coda dopo l'attesa
}
```
Uso:
```ts
import { whoAmI, sendMessage } from "./openwa";
await whoAmI(); // verifica
const { jobId } = await sendMessage({
  to: "+393331234567", mode: "text",
  text: "Ciao, il tuo ordine è pronto.", optIn: true,
});
```

### 5.2 Python (requests)
```python
# openwa.py
import os, time, requests

BASE = os.environ.get("OPENWA_BASE_URL", "https://openwa.isipc.com")
KEY = os.environ["OPENWA_API_KEY"]
H = {"X-Api-Key": KEY, "Content-Type": "application/json"}

def who_am_i():
    r = requests.get(f"{BASE}/api/v1/me", headers=H, timeout=15)
    r.raise_for_status()
    return r.json()  # {sessionId, phoneLabel, status, scopes}

def send_message(**payload):
    """payload: to, mode, text|templateId+vars|intent+context, optIn, scheduledAt."""
    r = requests.post(f"{BASE}/api/v1/messages", headers=H, json=payload, timeout=15)
    if r.status_code == 202:
        return r.json()["jobId"]
    raise RuntimeError(f"OpenWA send {r.status_code}: {r.text}")

def get_status(job_id):
    r = requests.get(f"{BASE}/api/v1/messages/{job_id}", headers=H, timeout=15)
    r.raise_for_status()
    return r.json()

def send_and_wait(tries=20, every_s=30, **payload):
    job_id = send_message(**payload)
    for _ in range(tries):
        s = get_status(job_id)
        if s["status"] in ("DONE", "FAILED", "CANCELED"):
            return s
        time.sleep(every_s)
    return get_status(job_id)
```

### 5.3 PHP (cURL) — tipico in un CRM
```php
<?php
function openwa_send(array $payload): string {
  $base = getenv("OPENWA_BASE_URL") ?: "https://openwa.isipc.com";
  $ch = curl_init("$base/api/v1/messages");
  curl_setopt_array($ch, [
    CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => ["X-Api-Key: " . getenv("OPENWA_API_KEY"), "Content-Type: application/json"],
    CURLOPT_POSTFIELDS => json_encode($payload),
  ]);
  $body = curl_exec($ch);
  $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);
  if ($code !== 202) throw new Exception("OpenWA $code: $body");
  return json_decode($body, true)["jobId"]; // salvalo sul record
}
```

---

## 6. Smoke test (verifica il collegamento)
```bash
# Deve restituire 200 con il numero legato alla key.
curl -s https://openwa.isipc.com/api/v1/me -H "X-Api-Key: $OPENWA_API_KEY"
# -> {"sessionId":"...","phoneLabel":"ISIPC principale","status":"CONNECTED","scopes":["messages:send"]}

# Invio di prova (a un numero che ha già scritto, oppure con optIn:true se hai il consenso):
curl -s -X POST https://openwa.isipc.com/api/v1/messages \
  -H "X-Api-Key: $OPENWA_API_KEY" -H "Content-Type: application/json" \
  -d '{"to":"+39XXXXXXXXXX","mode":"text","text":"Test integrazione","optIn":true}'
# -> 202 {"jobId":"..."} ; poi: curl .../api/v1/messages/<jobId> -H "X-Api-Key: $OPENWA_API_KEY"
```

---

## 7. Codici di errore

| HTTP | `error` | Causa | Azione |
|---|---|---|---|
| `202` | — | Accettato e in coda | Salva `jobId`, poi polling stato |
| `400` | `invalid body` | Campi mancanti/non validi (vedi `issues`) | Correggi il payload |
| `401` | `unauthorized` | `X-Api-Key` mancante/errata/revocata | Verifica la key |
| `403` | `forbidden` (`need: messages:send`) | Key senza scope invio | Usa una key con scope `messages:send` |
| `403` | `opt_in_required` | Contatto nuovo senza consenso | Passa `optIn:true` se hai il consenso |
| `409` | `number_unavailable` | Key non legata a un numero valido | Avvisa l'admin OpenWA (ricollega/rigenera) |
| `5xx` | — | Errore temporaneo | Ritenta con backoff |

---

## 8. Promemoria

- **Una key = un numero.** Il mittente è quello della key; nessun campo `from`.
- **Segreto lato server.** Mai esporre `OPENWA_API_KEY` nel client/repo pubblico.
- **Salva il `jobId`** su ogni record: è il riferimento per tracciare la consegna.
- **Numeri destinatario in formato internazionale** (`+39...`).
- **Consegna graduale** (anti‑ban): non aspettarti invii istantanei né di massa immediati.
- Base URL: `https://openwa.isipc.com` · Endpoint: `POST/GET /api/v1/messages`, `GET /api/v1/me`.
