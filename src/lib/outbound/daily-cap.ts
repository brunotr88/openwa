/**
 * Conteggio unico "messaggi OUT inviati oggi" per il dailyCap anti-ban.
 *
 * Usato da: GET /api/settings (barra "Oggi: X/cap" in UI), guard AI in
 * reply.ts e worker outbound — deve restare la STESSA definizione ovunque
 * (stesso criterio, stessa finestra), altrimenti la barra mostrata in UI
 * può disallinearsi dal comportamento reale del cap.
 *
 * Criterio: tutti i messaggi OUT (manuali + AI) con esito SENT/DELIVERED/READ,
 * finestra = mezzanotte nel fuso orario del TENANT (settings.hours.timezone),
 * non nel fuso del server.
 */
import { db } from "@/lib/db";
import { zonedDate, zonedToUtc } from "@/lib/appointments/slots";

export async function countSentToday(sessionId: string, timezone: string, now: Date = new Date()): Promise<number> {
  const today = zonedDate(now, timezone);
  const startOfDay = zonedToUtc(today.y, today.m, today.d, 0, 0, timezone);
  return db.message.count({
    where: {
      conversation: { sessionId },
      direction: "OUT",
      status: { in: ["SENT", "DELIVERED", "READ"] },
      createdAt: { gte: startOfDay },
    },
  });
}
