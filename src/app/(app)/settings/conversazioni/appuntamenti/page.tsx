/**
 * Conversazioni → Appuntamenti (M5) — server component: legge l'email del
 * service account Google dalla env di piattaforma (mai esposta come secret:
 * è l'indirizzo da invitare sul calendario) e delega il resto al client.
 */
import { AppuntamentiClient } from "./appuntamenti-client";

export const dynamic = "force-dynamic";

export default function AppuntamentiPage() {
  const saEmail = process.env.GOOGLE_SA_EMAIL?.trim() || null;
  return <AppuntamentiClient saEmail={saEmail} />;
}
