# PRODUCT — OpenWA

register: product

## Product Purpose
OpenWA è una piattaforma SaaS multi-tenant che collega numeri WhatsApp ad AI configurabili (AWS Bedrock) per il customer care: inbox condivisa, auto-risposta AI, co-pilot umano (l'AI scrive bozze, l'operatore approva), campagne, knowledge base, prenotazione appuntamenti. Cliente pilota: ISIPC (laboratorio IT/sicurezza, Treviso). È uno strumento operativo: l'operatore è in un task (leggere/rispondere conversazioni, configurare il bot), il design SERVE il compito e deve sparire.

## Users
- **Operatore inbox** (titolare/segreteria PMI, 30-60 anni, non tecnico): gestisce conversazioni WhatsApp dei clienti dal desktop e dal telefono. Vuole: vedere chi scrive (nome+numero reale), approvare/modificare le bozze AI in fretta, rispondere a mano. Velocità e chiarezza prima di tutto.
- **Admin/configuratore**: imposta personalità del bot, regole, orari, anti-ban, appuntamenti. Pochi campi alla volta, consigli pratici inline.

## Tone
Professionale, caldo, concreto. Italiano formale-ma-amichevole. Copy che riduce l'ansia operativa ("la sessione è attiva", "bozza pronta da approvare"). Mai gergo tecnico in faccia all'operatore.

## Anti-references
- WhatsApp-clone verde sgargiante / Mr. Robot hacker-theatre.
- SaaS-slop: viola su bianco, hero-metric template, griglie di card identiche icona+titolo+testo.
- Dashboard fredda e anonima: questo è uno strumento che si usa tutto il giorno, deve essere riposante e leggibile.

## Strategic principles
1. **L'inbox è il prodotto.** Deve essere impeccabile e perfettamente responsive (desktop due-pannelli, mobile lista↔chat). Tutto il resto serve l'inbox.
2. **Familiarità guadagnata.** Pattern standard (side nav desktop, bottom-nav mobile, thread chat, form). Niente affordance inventate per task standard.
3. **Mobile è di pari livello.** L'operatore risponde anche dal telefono: ogni schermata funziona a 375px.
4. **Il colore ha significato.** Verde = azione primaria/stato connesso; ambra = bozza/attenzione; rosso = errore/ban. Mai decorazione.
