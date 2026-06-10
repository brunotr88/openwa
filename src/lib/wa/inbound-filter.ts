/**
 * Filtro JID/tipo per i messaggi inbound (whatsapp-ops.md, M4).
 * Pure function — usata dal webhook e testata in isolamento.
 */
import type { TenantSettings } from "@/lib/settings/schema";

/**
 * Strip @c.us / @s.whatsapp.net / @lid suffix to get a bare wa id.
 * @lid (Linked ID) is privacy-preserving but stable → usable as contact key;
 * group ids keep their @g.us suffix (stable group key).
 */
export function normalizeWaId(chatId: string): string {
  return chatId.replace(/@(c\.us|s\.whatsapp\.net|lid)$/, "");
}

/** Message types never processed (system/protocol noise — whatsapp-ops.md). */
const IGNORED_TYPES = new Set([
  "reaction",
  "message_reaction",
  "e2e_notification",
  "notification",
  "notification_template",
  "protocol",
  "protocol_message",
  "revoked",
  "gp2",
  "call_log",
  "call",
  "ciphertext",
  "broadcast_notification",
]);

/** Pure JID/type filter — true when the event must be skipped entirely. */
export function shouldIgnoreInbound(
  data: Record<string, unknown>,
  settings: TenantSettings
): boolean {
  if (data.fromMe === true) return true; // echo dei propri invii → loop!

  const type = typeof data.type === "string" ? data.type : "";
  if (IGNORED_TYPES.has(type)) return true;

  const chatId =
    typeof data.chatId === "string" ? data.chatId : String(data.from ?? "");
  if (!chatId) return true;

  if (chatId === "status@broadcast" && settings.inbox.filterStatusBroadcast) return true;
  if (chatId.endsWith("@newsletter") && settings.inbox.filterNewsletter) return true;
  // Liste broadcast ([timestamp]@broadcast) — include status@broadcast.
  if (chatId.endsWith("@broadcast")) return true;

  const isGroup = data.isGroup === true || chatId.endsWith("@g.us");
  if (isGroup && settings.inbox.filterGroups === "ignora") return true;

  return false;
}
