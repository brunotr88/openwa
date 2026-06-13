/** Template testuali con placeholder {{nome}}. Funzioni pure. */
const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(VAR_RE)) seen.add(m[1]);
  return [...seen];
}

export function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(VAR_RE, (_full, name: string) => {
    if (!(name in vars)) {
      throw new Error(`Variabile mancante nel template: ${name}`);
    }
    return vars[name];
  });
}
