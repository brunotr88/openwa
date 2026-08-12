/**
 * Trasparenza AI Act — Art. 50 (Reg. UE 2024/1689), applicabile dal 2/8/2026.
 *
 * Art. 50(1): il FORNITORE garantisce che i sistemi di IA destinati a interagire
 * direttamente con persone fisiche siano "progettati e sviluppati in modo tale
 * che le persone fisiche interessate siano informate del fatto di stare
 * interagendo con un sistema di IA".
 * Art. 50(5): l'informazione è fornita "in maniera chiara e distinguibile al più
 * tardi al momento della prima interazione".
 *
 * Perché qui e non solo nel prompt: un'istruzione di sistema è un suggerimento
 * che il modello può omettere: non è una garanzia di progettazione. Questo
 * modulo rende la disclosure DETERMINISTICA — se il testo generato non contiene
 * già una dichiarazione riconoscibile, la aggiunge il codice.
 *
 * NB: obbligo del fornitore ⇒ vale per TUTTI i numeri/tenant del prodotto, non
 * solo per la configurazione di un singolo cliente.
 */

/**
 * Formulazioni che valgono già come dichiarazione di essere un sistema di IA.
 * Se il modello si è già presentato (come gli chiede il prompt), non
 * raddoppiamo: la disclosure resta una sola, chiara.
 */
const DISCLOSURE_PATTERNS: RegExp[] = [
  /assistente\s+virtuale/i,
  /assistente\s+(?:digitale|automatic\w+|ai\b|IA\b)/i,
  /\bchatbot\b/i,
  /\bbot\b(?!\w)/i,
  /sono\s+un[' ]?(?:\s*)(?:intelligenza\s+artificiale|IA\b|AI\b)/i,
  /intelligenza\s+artificiale/i,
  /risponde\s+un\s+sistema\s+di\s+(?:IA|AI)/i,
  /non\s+sono\s+una\s+persona/i,
];

/** true se il testo dichiara già, in modo riconoscibile, di essere un'IA. */
export function hasAiDisclosure(text: string): boolean {
  return DISCLOSURE_PATTERNS.some((re) => re.test(text));
}

/**
 * Riga di trasparenza: chiara e distinguibile (Art. 50(5)) — separata dal corpo
 * del messaggio — e con l'uscita verso un umano, che è buona prassi oltre che
 * utile al cliente.
 */
export function disclosureLine(businessName?: string | null): string {
  const name = (businessName ?? "").trim();
  return name
    ? `— Sono l'assistente virtuale (IA) di ${name}: se preferisci parlare con una persona, dimmelo.`
    : `— Sono un assistente virtuale (IA): se preferisci parlare con una persona, dimmelo.`;
}

/**
 * Restituisce il testo garantendo la presenza della disclosure.
 * Idempotente: se il testo si presenta già come IA, torna invariato.
 */
export function applyAiDisclosure(
  text: string,
  opts: { businessName?: string | null } = {}
): string {
  const body = text.trim();
  if (!body) return body;
  if (hasAiDisclosure(body)) return body;
  return `${body}\n\n${disclosureLine(opts.businessName)}`;
}
