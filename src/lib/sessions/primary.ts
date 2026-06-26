/** Sessione "primaria" di un insieme: la CONNECTED più recente, altrimenti la
 *  più recente in assoluto. Pura — usata da migrazione, API e UI. */
export interface SessionLike {
  id: string;
  status: string;
  createdAt: Date;
}

export function pickPrimarySession(sessions: SessionLike[]): string | null {
  if (sessions.length === 0) return null;
  const byNewest = [...sessions].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  const connected = byNewest.find((s) => s.status === "CONNECTED");
  return (connected ?? byNewest[0]).id;
}
