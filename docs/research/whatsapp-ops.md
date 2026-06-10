# Best practice operative — Automazione WhatsApp via whatsapp-web.js (non ufficiale) — 2025/2026

**Premessa chiave (verificata su 3 fonti indipendenti):** il rischio reale dipende quasi tutto dalla *direzione* dei messaggi. Bot **solo-reattivi** (rispondono a messaggi in arrivo) hanno ban-rate **< 2% su 12 mesi**; bot che fanno **outreach proattivo a freddo** hanno ban-rate **15-30% su 12 mesi**, con ban permanente senza appello. Dal 2026 WhatsApp traccia anche i **messaggi senza risposta entro 48h** su un contatore mobile a 30 giorni. Il prodotto deve quindi trattare l'AI auto-reply come "zona sicura" e le campagne outbound come "zona ad alto rischio" con limiti rigidi.

## Limiti e ritmi consigliati

### Warm-up numero nuovo (ramp giorno per giorno)
Basato sui default del middleware baileys-antiban (fattore di crescita 1.8) incrociati con GREEN-API (max 20 nuovi contatti/giorno nei primi 10 giorni) e WASender:

| Giorno | Msg/giorno (cap) | Nuovi contatti/giorno (cap) | Note |
|---|---|---|---|
| 0 | 0 | 0 | Solo registrazione + uso manuale dall'app. Attendere 24h prima di collegare la sessione web |
| 1 | 20 | 10 | Solo risposte o contatti noti |
| 2 | 35 | 10 | |
| 3 | 65 | 15 | |
| 4 | 115 | 15 | |
| 5 | 210 | 20 | |
| 6 | 380 | 20 | |
| 7 | 680 | 20 | |
| 8-14 | 800 | 30 | Primi 10 giorni = periodo a rischio massimo: niente campagne |
| 15+ (rodato) | 1.000-1.500 | 50 | Solo se reply-rate > 30% |

Re-warm-up: se il numero resta inattivo > 72h, riparti 2-3 gradini indietro nella scala.

### Ritmi di invio (numero rodato)

| Parametro | Default consigliato | Range sicuro |
|---|---|---|
| Delay tra messaggi (risposte AI) | 3-8 s randomizzato | min 1,5 s – max 10 s |
| Delay tra messaggi (campagne/outbound) | 15-45 s randomizzato | mai sotto 8 s |
| Penalità primo messaggio a sconosciuto | +3 s extra (moltiplicatore 2,5× sul delay) | — |
| Cap al minuto | 8 msg/min | max assoluto 30/min |
| Cap orario | 60 msg/h (campagne), 200 msg/h (totale incluse risposte) | "safe zone" community: < 30/h proattivi |
| Pausa lunga | 10-15 min ogni 50 msg di campagna (oppure 5 min ogni 100) | |
| Finestra campagne | max 8 h/giorno, max 3 giorni consecutivi, solo orario lavorativo | |
| Messaggi identici | max 5 nella stessa ora; oltre, varia il testo (spintax/nome destinatario) | danger > 15/h |
| Reply-rate target | > 30% | warning 15-30%, danger < 15% → stop automatico |

## Flag operativi consigliati

| Flag | Default | Quando attivarlo | Consiglio UI (1-2 frasi) |
|---|---|---|---|
| `replyOnlyMode` | **ON** | Sempre, finché il cliente non ha base opt-in pulita | "Il bot risponde solo a chi ti scrive: è la modalità più sicura (rischio ban < 2%). Disattivala solo per campagne a contatti che hanno dato consenso." |
| `warmupMode` | **ON** (auto per numeri < 15 gg) | Numero appena collegato o riattivato dopo > 72h di inattività | "Numero in rodaggio: i limiti giornalieri crescono gradualmente per 2 settimane. Forzare l'invio ora è la causa n.1 di ban." |
| `randomDelay` (min/max) | **ON**, 3-8 s | Sempre | "Ritardo casuale tra le risposte per simulare un operatore umano. Non scendere sotto 2 secondi." |
| `typingIndicator` | **ON**, durata ∝ lunghezza risposta (~45 parole/min, max 25 s) | Sempre con AI auto-reply | "Mostra 'sta scrivendo…' prima di rispondere: rende il bot indistinguibile da un operatore e migliora l'esperienza." |
| `dailyCap` / `hourlyCap` | 1.000/gg, 200/h (auto-ridotti in warm-up) | Sempre | "Tetto di sicurezza giornaliero. Superarlo non invia più nulla fino a domani: meglio un cliente in attesa che un numero bannato." |
| `businessHoursOnly` | **ON** per outbound, OFF per risposte | Campagne e follow-up | "Le campagne partono solo in orario lavorativo (es. 9-19): invii notturni sono un forte segnale spam. Le risposte ai clienti restano sempre attive." |
| `autoOptOut` (STOP) | **ON** | Qualsiasi outbound | "Riconosce 'STOP'/'CANCELLAMI' e blocca il contatto. Obbligatorio: i report degli utenti sono la prima causa di ban." |
| `messageVariation` | **ON** per broadcast | Campagne > 5 destinatari | "Inserisce il nome del cliente e varia le frasi: mai lo stesso identico testo a decine di persone." |
| `linkGuard` | **ON** | Sempre | "Blocca link accorciati (bit.ly ecc.) verso nuovi contatti e avvisa se il primo messaggio contiene un link: alto rischio segnalazione." |
| `mediaFirstMessage` | **OFF** | — | "Niente immagini/allegati nel primo messaggio a un contatto nuovo: prima testo breve con domanda, i media solo in conversazione avviata." |
| `groupAutomation` | **OFF** | Quasi mai | "Aggiungere persone a gruppi o scrivere in gruppi via bot è tra le cause di ban più segnalate: tenerlo spento." |
| `interactiveButtons` | **OFF** | Mai con whatsapp-web.js | "Bottoni e liste via libreria non ufficiale causano ban documentati: usare testo semplice con opzioni numerate (1/2/3)." |
| `pauseOnRisk` | **ON** | Sempre | "Se compaiono segnali di rischio (disconnessioni ripetute, reply-rate basso), l'invio outbound si ferma da solo e ti avvisiamo." |
| `phoneOnlineCheck` | **ON** | Sempre | "Ti avvisa se il telefono collegato è offline da troppo: dopo 14 giorni offline la sessione scade e serve ri-scansione QR." |

**Stabilità sessione (impostazioni interne, non toggle):** `LocalAuth` con storage persistente; telefono acceso e connesso (max 14 giorni offline, ma le sessioni wwebjs degradano anche in 2-3 giorni se il telefono sparisce); riconnessione automatica con backoff esponenziale e, dopo riconnessione, ramp-up del rate su ~60 s (10%→100% in 6 step); evitare cicli rapidi disconnect/reconnect; IP residenziale preferibile; prevedere ri-scansione QR occasionale (avviso al tenant via dashboard/email).

## Tipi di messaggi/JID da filtrare nella inbox

| JID / tipo | Cos'è | Azione inbox |
|---|---|---|
| `status@broadcast` | Stati/Storie dei contatti | **IGNORA** (non processare con AI, non mostrare) |
| `*@newsletter` | Canali WhatsApp | **IGNORA** |
| `[timestamp]@broadcast` | Liste broadcast in arrivo | **IGNORA** per l'AI; opzionale mostrare |
| `*@g.us` | Gruppi | **MOSTRA ma NON auto-rispondere** (default); toggle separato, alto rischio |
| `*@lid` | Linked ID: identificativo privacy che sostituisce il numero (gruppi con "nascondi numero", e dal 2025-26 progressivamente ovunque) | **MOSTRA e tratta come contatto normale**: si può rispondere normalmente. Non risolvibile in numero lato client; usare il LID come chiave contatto stabile |
| `*@c.us` / `*@s.whatsapp.net` | Chat 1:1 standard | **MOSTRA + AI** |
| `message_reaction` | Reazioni emoji | **IGNORA per l'AI**; opzionale badge sul messaggio |
| Protocol messages (revoke/delete, edit) | Cancellazioni/modifiche | **NON processare con AI**; aggiorna/segna il messaggio originale come "eliminato/modificato" |
| `e2e_notification`, `notification_template`, `gp2`, call log | Eventi di sistema | **IGNORA** |
| `ciphertext` (messaggi non decifrabili) | Sintomo di sessione degradata | **IGNORA in inbox ma CONTA come segnale di rischio sessione** |
| Messaggi effimeri / view-once | Contenuto a scomparsa | **MOSTRA con etichetta**; non far citare il contenuto all'AI in messaggi successivi |
| `fromMe = true` (echo dei propri invii) | Messaggi inviati da altri device | **MOSTRA come outbound**, mai processare con AI (loop!) |

## Segnali di rischio ban e azioni

| Segnale | Soglia | Azione automatica consigliata |
|---|---|---|
| Errore 403 Forbidden su invio | 1 evento | +40 punti rischio; pausa outbound 1h |
| Errore 401 / evento LOGOUT | 1 evento | +60 punti; stop totale invii, notifica tenant "ri-scansiona QR" |
| Errore 463 (reach-out timelock: troppi contatti nuovi) | 1 evento | +25 punti; stop nuovi contatti 24h, prosegui solo risposte |
| Reply-rate < 15% (ultimi 7 gg) | sotto soglia | Stop campagne, consenti solo reply-mode; suggerisci pulizia lista |
| Messaggi senza risposta entro 48h in crescita | > 50% degli outbound | Riduci volume del 50%, alza il delay |
| Blocchi/segnalazioni utenti | ≥ 2% dei contatti raggiunti, o più report in 24h | Stop outbound 7-14 gg (tempo tipico di recupero reputazione) |
| Disconnessioni frequenti sessione | ≥ 3 in 24h | +15-30 punti; ramp-up 60 s alla riconnessione; alert tenant |
| Messaggi non decifrabili / delivery lenti | ricorrente | Alert "sessione degradata": consigliare re-pair prima che diventi ban |
| Telefono offline | > 24h | Alert tenant; > 10 gg: alert critico (a 14 gg la sessione scade) |
| Punteggio rischio cumulativo | 0-29 ok / 30-59 warning / 60-84 high / 85+ critical | Warning: -50% rate. High: solo reply-mode. Critical: freeze totale + notifica |

**Orari/SLA Italia** (default `businessHours`): aspettativa utenti italiani = risposta "da chat", entro pochi minuti; soglia massima ~1 ora in orario lavorativo. Default consigliati: 9:00-13:00 / 14:30-19:00 lun-ven, auto-reply fuori orario con orari dichiarati, SLA: prima risposta < 5 min (AI), presa in carico umana < 1h; escalation a operatore dopo 2 tentativi falliti del bot.

## Fonti
wasenderapi.com (anti-ban 2025), github.com/kobie3717/baileys-antiban, green-api.com (blocking), achiya-automation.com (spam detection 2026), wapisimo.dev (ban risk), chatarmin.com (limiti), GitHub wwebjs issues #3565 #2701 #981 #2052 #1880 #3250 #3224 #5682 #1393, wwebcustomizer.com (14 giorni offline), whapi.cloud (@lid), baileys.wiki (LID/PN), docs.wwebjs.dev, developers.facebook.com (typing 25s), accueil.it / 3cx.it / ferpi.it (SLA Italia).
