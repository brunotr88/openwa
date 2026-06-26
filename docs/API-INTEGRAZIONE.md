# OpenWA — Guida all'integrazione dell'API privata

Questa guida spiega come collegare un'applicazione esterna (CRM, gestionale, e‑commerce, automazioni)
all'API privata di OpenWA per **far inviare messaggi WhatsApp** ai contatti.

> **In una frase:** la tua app chiama un endpoint REST passando *numero + messaggio*; OpenWA mette il
> messaggio in coda e lo invia tramite WhatsApp rispettando le protezioni anti‑ban. Risposta immediata
> con un `jobId`; lo stato di consegna si recupera con una seconda chiamata.

- **Base URL:** `https://openwa.isipc.com`
- **Autenticazione:** header `X-Api-Key: owa_live_...`
- **Formato:** JSON (`Content-Type: application/json`)

---

## 1. Ottenere una API key

1. Accedi a OpenWA → **Impostazioni → Sviluppatori**.
2. **Scegli il numero** (sessione WhatsApp) da cui la key invierà, inserisci un'etichetta
   (es. `CRM aziendale`) e premi **Crea key**.
3. **Copia subito** la chiave mostrata (formato `owa_live_...`): viene visualizzata **una sola volta**,
   nel database resta solo il suo hash. Se la perdi, creane una nuova e revoca la vecchia.

**Una key = un numero.** Ogni chiave è **legata al numero scelto alla creazione**: il numero mittente
degli invii è determinato dalla key, non si passa nella richiesta. Per inviare da più numeri, crea una
key per ciascun numero. La chiave va inviata nell'header `X-Api-Key` di ogni richiesta. Per revocarla,
di nuovo da **Impostazioni → Sviluppatori → Revoca**: le app che la usano smettono di funzionare
immediatamente.

> Per sapere da quale numero invii con una certa key, chiama `GET /api/v1/me` (vedi §1bis).

> Conserva la chiave come un segreto (variabile d'ambiente lato server, **mai** nel frontend / codice
> pubblico). Lo scope attualmente assegnato è `messages:send`.

---

## 1bis. Sapere da che numero invii — `GET /api/v1/me`

Poiché il numero mittente è determinato dalla key, usa questo endpoint per scoprire **a quale numero**
è legata la chiave che stai usando (utile per mostrarlo nel CRM o per validare la configurazione).

### `GET /api/v1/me`

**Headers:** `X-Api-Key: owa_live_...`

**Risposta — `200 OK`**
```json
{
  "sessionId": "cmqctuya30005p90150f5ts5l",
  "phoneLabel": "Principale",
  "status": "CONNECTED",
  "scopes": ["messages:send"]
}
```

| Campo | Descrizione |
|---|---|
| `sessionId` | ID interno della sessione/numero legato alla key. |
| `phoneLabel` | Etichetta del numero (quella scelta in OpenWA). |
| `status` | Stato della sessione WhatsApp (es. `CONNECTED`, `DISCONNECTED`). |
| `scopes` | Scope assegnati alla key (es. `messages:send`). |

Se la key non è più legata a un numero valido, ricevi `409 number_unavailable` (vedi §6).

---

## 2. Inviare un messaggio

> **Numero mittente:** non esiste un campo `from`. Il numero da cui parte il messaggio è quello
> **legato alla key** usata (vedi §1). Per inviare da un altro numero, usa la key di quel numero.

### `POST /api/v1/messages`

**Headers**

| Header | Valore |
|---|---|
| `X-Api-Key` | `owa_live_...` (obbligatorio) |
| `Content-Type` | `application/json` |

**Body** — tre modalità di invio (`mode`):

| Campo | Tipo | Obblig. | Descrizione |
|---|---|---|---|
| `to` | string | sì | Numero destinatario in formato internazionale, es. `+393331234567`. Spazi/trattini ignorati. |
| `mode` | `text` \| `template` \| `intent` | sì | Modalità di composizione del messaggio (vedi sotto). |
| `text` | string | se `mode=text` | Testo esatto del messaggio (max 4096 caratteri). |
| `templateId` | string | se `mode=template` | ID di un template creato in OpenWA. |
| `vars` | object | no | Variabili del template, es. `{ "prodotto": "PC portatile" }`. `{{nome}}` è compilato in automatico dal contatto. |
| `intent` | string | se `mode=intent` | Istruzione per l'AI, che **compone** il messaggio col tono del brand (es. `avvisa che l'ordine è pronto per il ritiro`). |
| `context` | object | no | Dati aggiuntivi per il modo `intent`, es. `{ "ordine": "A-1024", "importo": 120 }`. |
| `optIn` | boolean | no | `true` dichiara che **hai raccolto il consenso** del contatto (necessario per numeri nuovi — vedi §4). |
| `scheduledAt` | string ISO‑8601 | no | Invio programmato, es. `2026-06-16T09:00:00Z`. Se assente, "appena possibile" (rispettando orari/anti‑ban). |

**Le tre modalità**

- **`text`** — invii tu il testo esatto. Massimo controllo.
- **`template`** — usi un template salvato in OpenWA con placeholder `{{nome}}`, `{{...}}`. `{{nome}}` è
  riempito automaticamente dal nome del contatto; gli altri li passi in `vars`.
- **`intent`** — descrivi *cosa* comunicare e l'AI scrive il messaggio col tono dell'attività, usando
  l'eventuale memoria del contatto. Comodo per messaggi personalizzati, meno deterministico.

**Risposta — `202 Accepted`**

```json
{ "jobId": "cmqctuya30005p90150f5ts5l", "status": "PENDING" }
```

Il `202` significa **accettato e messo in coda**, non "consegnato". Conserva il `jobId` per controllarne
lo stato (§3). La consegna è **asincrona** (vedi §5).

### Esempi

**cURL**
```bash
curl -X POST https://openwa.isipc.com/api/v1/messages \
  -H "X-Api-Key: owa_live_xxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+393331234567",
    "mode": "text",
    "text": "Ciao Mario, il tuo ordine A-1024 è pronto per il ritiro.",
    "optIn": true
  }'
```

**Node.js (fetch)**
```js
const res = await fetch("https://openwa.isipc.com/api/v1/messages", {
  method: "POST",
  headers: {
    "X-Api-Key": process.env.OPENWA_API_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    to: "+393331234567",
    mode: "text",
    text: "Ciao Mario, il tuo ordine A-1024 è pronto per il ritiro.",
    optIn: true,
  }),
});
const data = await res.json(); // { jobId, status } se 202
if (res.status !== 202) throw new Error(`OpenWA: ${res.status} ${JSON.stringify(data)}`);
console.log("jobId:", data.jobId);
```

**PHP (cURL)** — tipico in un CRM
```php
<?php
$payload = [
  "to"    => "+393331234567",
  "mode"  => "template",
  "templateId" => "tpl_abc123",
  "vars"  => ["prodotto" => "PC portatile"],
  "optIn" => true,
];
$ch = curl_init("https://openwa.isipc.com/api/v1/messages");
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    "X-Api-Key: " . getenv("OPENWA_API_KEY"),
    "Content-Type: application/json",
  ],
  CURLOPT_POSTFIELDS => json_encode($payload),
]);
$body = curl_exec($ch);
$code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
$data = json_decode($body, true);
if ($code !== 202) { throw new Exception("OpenWA $code: $body"); }
$jobId = $data["jobId"]; // salvalo sul record CRM
```

**Python (requests)**
```python
import os, requests

r = requests.post(
    "https://openwa.isipc.com/api/v1/messages",
    headers={"X-Api-Key": os.environ["OPENWA_API_KEY"]},
    json={
        "to": "+393331234567",
        "mode": "intent",
        "intent": "avvisa che il preventivo è pronto e invitalo a passare in negozio",
        "context": {"preventivo": "P-2025-09"},
        "optIn": True,
    },
    timeout=15,
)
r.raise_for_status()  # solleva su 4xx/5xx
job_id = r.json()["jobId"]
```

---

## 3. Controllare lo stato di un invio

### `GET /api/v1/messages/{jobId}`

**Headers:** `X-Api-Key: owa_live_...`

**Risposta — `200 OK`**
```json
{
  "id": "cmqctuya30005p90150f5ts5l",
  "status": "DONE",
  "mode": "TEXT",
  "attempts": 0,
  "lastError": null,
  "messageId": "cmqcu8mk80009p9015kwdcqrh",
  "scheduledAt": null,
  "sentAt": "2026-06-13T20:58:55.681Z",
  "createdAt": "2026-06-13T20:48:17.931Z",
  "messageStatus": "SENT"
}
```

**Stati del job (`status`)**

| Stato | Significato |
|---|---|
| `PENDING` | In coda, in attesa di invio (o di una finestra oraria valida). |
| `SENDING` | In invio in questo momento. |
| `DONE` | Inviato con successo (vedi `messageStatus`). |
| `FAILED` | Non inviato — vedi `lastError`. |
| `CANCELED` | Annullato (es. campagna annullata). |

`messageStatus` riflette lo stato del messaggio WhatsApp una volta partito: `SENT`, `DELIVERED`, `READ`, `FAILED`.

**Pattern consigliato:** dopo aver ricevuto il `jobId`, fai *polling* dello stato ogni ~30–60 secondi
finché diventa `DONE` o `FAILED`. Non assumere consegna immediata (§5).

```js
async function waitDelivery(jobId, { tries = 30, everyMs = 30000 } = {}) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://openwa.isipc.com/api/v1/messages/${jobId}`, {
      headers: { "X-Api-Key": process.env.OPENWA_API_KEY },
    });
    const j = await r.json();
    if (j.status === "DONE" || j.status === "FAILED") return j;
    await new Promise((res) => setTimeout(res, everyMs));
  }
  return null; // ancora in coda dopo l'attesa
}
```

---

## 4. Consenso (opt‑in) — importante

Per ridurre il rischio di ban e per conformità (GDPR), OpenWA invia **solo** a contatti che:

- hanno **già scritto** all'attività (consenso implicito), **oppure**
- per cui dichiari il consenso passando **`"optIn": true`** nella richiesta.

Se invii a un numero **nuovo** senza `optIn`, ricevi:

```json
{ "error": "opt_in_required", "hint": "il contatto non ha consenso né ha mai scritto; passa optIn:true se l'app ha raccolto il consenso" }
```
(HTTP `403`).

Passando `optIn: true` **ti assumi la responsabilità** di aver raccolto un consenso valido (il CRM è la
fonte di verità del consenso). L'azione viene registrata nei log di audit di OpenWA. Il contatto viene
creato/segnato come opt‑in nel workspace.

> **Buona pratica CRM:** invia `optIn: true` solo per i contatti che nel tuo CRM risultano avere
> acconsentito a comunicazioni WhatsApp. Non usarlo per liste fredde/acquistate.

---

## 5. Come avviene la consegna (anti‑ban) — cosa aspettarsi

OpenWA usa la sessione WhatsApp Web del numero dell'attività, quindi protegge il numero da ban con regole
che **rendono la consegna asincrona e a volte differita**. La tua integrazione deve tenerne conto:

- **Coda + ritmo:** i messaggi vengono inviati gradualmente (di norma ~1 al minuto per sessione). Una
  raffica di richieste non parte tutta insieme: entra in coda e si svuota nel tempo.
- **Orari di lavoro:** se nel workspace è attivo *"solo in orario lavorativo"* (default Lun‑Ven 09–19),
  i messaggi accodati fuori orario **partono alla prossima finestra** (es. lunedì mattina). In `GET`
  vedrai `status: PENDING` con `lastError: "outside_hours"` finché non è ora.
- **Tetti giornalieri/orari** per proteggere il numero.
- **Invio programmato:** usa `scheduledAt` per pianificare (rispetta comunque orari e ritmo).
- **Consegna at‑most‑once:** in caso di interruzione ambigua, un job non viene re‑inviato in automatico
  (diventa `FAILED`); sarà la tua app a decidere se ritentare. Non ci sono doppi invii a sorpresa.
- **Scadenza:** un job che non riesce a partire entro **7 giorni** viene marcato `FAILED` (`expired`).

**Conseguenza pratica per il CRM:** tratta l'invio come una richiesta *accettata*, non *consegnata*.
Salva il `jobId` sul record e aggiorna lo stato via polling (§3) o mostra "in coda / inviato / non riuscito".

---

## 6. Codici di errore

| HTTP | `error` | Causa | Cosa fare |
|---|---|---|---|
| `202` | — | Accettato e messo in coda | Salva `jobId`, poi controlla lo stato |
| `400` | `invalid body` | JSON o campi non validi (vedi `issues`) | Correggi il payload |
| `401` | `unauthorized` | `X-Api-Key` mancante o sconosciuta/revocata | Verifica la chiave |
| `403` | `forbidden` (`need: messages:send`) | La key non ha lo scope di invio | Usa una key con scope `messages:send` |
| `403` | `opt_in_required` | Contatto nuovo senza consenso | Passa `optIn: true` se hai il consenso (§4) |
| `409` | `number_unavailable` | La key non è legata a un numero valido (numero rimosso/non trovato) | Crea una nuova key sul numero giusto in **Impostazioni → Sviluppatori** |
| `409` | `no whatsapp session` | Nessuna sessione WhatsApp collegata nel workspace | Collega/riattiva la sessione in OpenWA |
| `5xx` | — | Errore temporaneo | Ritenta con backoff |

---

## 7. Buone pratiche di integrazione

- **Segreto lato server:** la `X-Api-Key` va usata solo dal backend del CRM, mai esposta al browser.
- **Salva il `jobId`** su ogni record/messaggio del CRM: è il riferimento per tracciare la consegna.
- **Nessuna deduplica automatica:** se invii due volte la stessa richiesta, partono **due** messaggi.
  Se ti serve idempotenza, gestiscila lato CRM (es. non re‑inviare se esiste già un `jobId` per quel record).
- **Backoff sugli errori 5xx** e gestione esplicita di `403 opt_in_required` / `409 no whatsapp session`.
- **Polling ragionevole:** ogni 30–60 s, non in loop stretto. La consegna può richiedere minuti (o
  attendere l'orario lavorativo).
- **Numeri in formato internazionale** (`+39...`).

---

## 8. Riepilogo endpoint

| Metodo | Endpoint | Scopo | Auth |
|---|---|---|---|
| `GET` | `/api/v1/me` | Numero (sessione) legato alla key → `{ sessionId, phoneLabel, status, scopes }` | `X-Api-Key` |
| `POST` | `/api/v1/messages` | Accoda un invio (text/template/intent) → `202 { jobId }` | `X-Api-Key` (scope `messages:send`) |
| `GET` | `/api/v1/messages/{jobId}` | Stato e consegna di un invio | `X-Api-Key` |

Template e gestione delle key si configurano dall'interfaccia OpenWA
(**Impostazioni → Conversazioni → Template** e **Impostazioni → Sviluppatori**).
