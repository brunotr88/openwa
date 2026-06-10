# Ricerca UX: dashboard di configurazione per SaaS WhatsApp+AI multi-tenant

## Architettura informativa consigliata

Route group `/settings`, sidebar secondaria a sinistra (stile shadcn), contenuto a card. Due livelli max, raggruppati per job-to-be-done:

```
Impostazioni
├── 🤖 Agente AI
│   ├── Profilo e persona       (nome bot, descrizione azienda, settore/preset, tono, lingua, emoji, lunghezza)
│   ├── Comportamento risposte  (stile Preciso/Bilanciato/Creativo, regole fai/non-fare, istruzioni avanzate
│   │                            [collassate], escalation a umano, fallback, argomenti vietati)
│   ├── Knowledge Base 🔜       (placeholder "In arrivo")
│   └── Prova il bot            (playground, anche pulsante globale)
├── 💬 Conversazioni
│   ├── Orari e disponibilità   (orari per giorno, comportamento fuori orario)
│   ├── Invio e protezione numero (anti-ban: profilo Prudente/Standard/Aggressivo, cap, delay, typing,
│   │                            warm-up, pausa notturna)
│   └── Preferenze Inbox        (notifiche, chiusura auto conversazioni inattive)
├── 📱 WhatsApp
│   └── Sessioni e numeri       (QR, stato, salute numero, multi-numero)
└── ⚙️ Workspace
    ├── Team 🔜 / API & Webhook 🔜
    └── Generale
```

Motivazioni chiave: "Agente AI" è primo livello (è il prodotto); separare persona (chi è) da comportamento (come agisce) — pattern Zendesk/Intercom; "Invio e protezione numero" pagina propria = differenziatore (copy rassicurante "proteggiamo il tuo numero"); sessioni separate dalle policy di invio; sezioni future visibili ma "In arrivo".

## Pattern UX da adottare

| Pattern | Dove | Riferimento |
|---|---|---|
| Tono a scelte chiuse con descrizione (3-5 opzioni, mai textarea come primo livello) | Profilo: "Professionale — cortese e diretto (Consigliato)", "Amichevole", "Entusiasta", "Formale (Lei)" | Zendesk, Fin |
| Temperatura come segmented 3 modalità | Stile risposta = Preciso/Bilanciato/Creativo (badge Consigliato su Preciso); slider solo sotto "Avanzate" | MS Copilot, Chatbase |
| Istruzioni naturali categorizzate con template | Regole "fai/non fare" come liste per categoria, max ~300 char, esempi per settore come chip | Intercom Fin Guidance |
| Descrizione azienda auto-compilata | Onboarding: URL sito → pre-compila descrizione | Tidio |
| Toggle pericoloso con warning inline | "Rispondi fuori dalla KB" → alert ambra; "Disattiva limiti invio" → alert rosso + conferma esplicita | respond.io, NN/g |
| Reset alla configurazione consigliata | Bottone per pagina con diff di cosa cambia | respond.io |
| Preset card con badge "Consigliato" | Profilo invio: 3 card che mostrano i valori; modifica campo → "Personalizzato" | Fin + GREEN-API |
| Playground sempre a portata | Pulsante globale "Prova il bot" → drawer con mockup WhatsApp | Tidio, Fin Preview |
| Dal test alla correzione in un click | 👎 su risposta → "Aggiungi regola/FAQ" precompilata | Tidio Playground |
| Help inline (FormDescription) + AdviceCallout espandibile | Ogni setting: label + riga descrizione; warm-up spiegato con callout | Tidio Hub |
| Salute/score di configurazione | Card "Salute del numero" + "Completezza configurazione" con checklist | Tidio knowledge score |
| Master switch separato dal salvataggio | "Bot attivo" sticky in alto; "attivo sempre / solo fuori orario" | Tidio, Crisp |
| Trasparenza sui limiti | "Oggi: 142/300 messaggi inviati" | Tidio quota |

## Wizard di onboarding (5 step, <5 minuti, riprendibile)

1. **Connetti WhatsApp** — QR con istruzioni illustrate, stato live. Rileva numero "nuovo" → flag per anti-ban Prudente.
2. **Che attività hai?** — galleria card tipo business (preset). Nome attività + sito web opzionale → genera descrizione.
3. **Personalità del bot** — solo 3 controlli: nome bot, tono (4 card con frase di anteprima reale), descrizione (precompilata, da correggere).
4. **Proteggi il tuo numero** — card Prudente/Standard/Aggressivo; numero nuovo → Prudente bloccato + timeline warm-up visiva. Zero numeri editabili.
5. **Prova il tuo bot** — playground full-screen, chip domande del settore, 👍/👎, CTA "Attiva il bot 🚀".

Post-wizard: SetupChecklist persistente in dashboard ("4/7 completati...").

## Componenti UI necessari

1. `SettingsShell` — 2 colonne, sotto-nav sticky, voci 🔜 disabilitate, breadcrumb + "Prova il bot"
2. `SettingRow`/`SwitchSetting` — label + descrizione sotto + controllo; autosave+toast per toggle, Salva per card con dirty-state per i form
3. `RecommendedBadge` — fonte unica `recommendedDefaults` per preset, riusata dal reset
4. `RiskyToggle` — alert inline ambra/rosso + ConfirmDialog per i rossi
5. `PresetCardGroup` — 3 card radio con valori mostrati; edit → "Personalizzato"; avanzate in Accordion
6. `SegmentedControl` 3 opzioni — mappa temperatura/lunghezza internamente
7. `RuleList` fai/non-fare — contatore, limite N, chip esempi per settore, regole on/off senza cancellare
8. `AdvancedPromptEditor` — textarea in accordion "Per utenti esperti" + contatore
9. `BotPlayground` — mockup WhatsApp (bolle, spunte, "sta scrivendo..." secondo settings), chip domande, 👍/👎 con flusso correggi
10. `AdviceCallout` — 💡 titolo + 2-3 righe + azione opzionale
11. `HealthScoreCard` — punteggio + checklist con deep-link
12. `ScheduleEditor` — griglia orari per giorno, copia su tutti, fuori orario radio
13. `SessionCard` — stato, warm-up "giorno 6/14", contatore msg/limite, azioni
14. `ResetToRecommended` — dialog con diff
15. `SetupChecklist` — widget post-onboarding

## Fonti
Tidio (Lyro: Hub/Knowledge/Behavior/Playground/Configure), Intercom Fin (Guidance categorizzata, Preview), Zendesk AI Agents (persona, 3 toni, reply length), Crisp Hugo (3 step + Activation), respond.io (reply-outside-KB toggle, reset persona), WATI (wizard), Chatbase (playground, compare), GREEN-API/baileys-antiban (warm-up UI), NN/g (toggle guidelines), Appcues/Guideflow (setup checklist).
