# DESIGN — OpenWA ("Caldo & Operativo")

## Theme
Light di default (operatore in ufficio/telefono di giorno, ambiente illuminato, lettura prolungata: il chiaro caldo riposa). Dark via `.dark` + `prefers-color-scheme`.

## Color (OKLCH, tinted, Restrained)
- `--bg` avorio caldo `oklch(98% 0.008 85)`, `--surface` `oklch(99.5% 0.006 85)`, secondo livello neutro per nav/pannelli.
- `--ink` `oklch(24% 0.02 265)`, `--muted-foreground` `oklch(48% 0.015 265)`.
- `--primary` verde foresta `oklch(52% 0.11 158)` — azioni primarie, selezione, stato connesso.
- `--accent` ambra `oklch(72% 0.14 62)` — bozze/attenzione (uso parco).
- `--danger` `oklch(57% 0.19 25)` — errori/ban. Neutri sempre tinti, mai #000/#fff.

## Typography
- Display (`--font-display` Bricolage Grotesque): SOLO titoli di pagina/sezione, nome contatto. MAI label, dati, bottoni.
- Body/UI (`--font-body` Hanken Grotesk): tutto il resto.
- Mono (`--font-mono` Geist Mono): numeri di telefono, timestamp, contatori, codici.
- Scala fissa rem, ratio ~1.2. Riga prosa 65-75ch.

## Motion (product)
150-250ms, ease-out. La motion comunica STATO (hover/focus/active/loading/reveal), mai decorazione. **Niente page-load orchestrato/staggered.** Rispetta `prefers-reduced-motion`.

## Components
Ogni elemento interattivo: default/hover/focus/active/disabled/loading/error. Skeleton per il loading (non spinner al centro). Empty state che insegna. Stessa forma di bottone/controllo ovunque. Badge stato a pillola con `dark:` AA.

## Bans
Niente side-stripe border colorati, gradient-text, glassmorphism decorativo, em-dash nel copy, griglie di card identiche, hero-metric template.
