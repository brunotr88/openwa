/**
 * Contact name/phone resolution helpers (shared by the inbound webhook,
 * the backfill route and the inbox UI).
 *
 * WhatsApp now hides real numbers behind privacy `@lid` ids. The gateway's
 * GET /contacts/{id} endpoint maps a chat id back to the real phone + name:
 *   { id: "393478435299@c.us", pushName: "Enrico Zaratin", number: "127345..." }
 * - `id`       → real phone in `<number>@c.us` form (use the digits before @c.us)
 * - `pushName` → display name
 * - `number`   → the @lid digits (NOT a real number — never display)
 */
import type { GatewayContact } from "./gateway-client";

/** The fields a resolution can update on a Contact. */
export interface ResolvedContact {
  name?: string;
  phone?: string;
}

/**
 * Extract the real phone number (digits, no suffix) from a gateway contact's
 * `id` (e.g. "393478435299@c.us" → "393478435299"). Returns undefined when the
 * id is absent or not a `@c.us` phone id.
 */
export function realPhoneFromGatewayId(id: string | undefined | null): string | undefined {
  if (!id) return undefined;
  if (!id.endsWith("@c.us")) return undefined;
  const digits = id.replace(/@c\.us$/, "");
  return /^\d+$/.test(digits) ? digits : undefined;
}

/** Map a raw gateway contact onto the name/phone fields we persist. */
export function mapGatewayContact(contact: GatewayContact | null): ResolvedContact {
  if (!contact) return {};
  const out: ResolvedContact = {};
  if (typeof contact.pushName === "string" && contact.pushName.trim()) {
    out.name = contact.pushName.trim();
  }
  const phone = realPhoneFromGatewayId(contact.id);
  if (phone) out.phone = phone;
  return out;
}

/**
 * Build the Prisma `update` patch for a resolution: only set a field when the
 * resolution produced a value AND it is currently empty or has changed. Returns
 * an empty object when there is nothing to write.
 */
export function resolutionPatch(
  resolved: ResolvedContact,
  current: { name?: string | null; phone?: string | null }
): { name?: string; phone?: string } {
  const patch: { name?: string; phone?: string } = {};
  if (resolved.name && resolved.name !== (current.name ?? undefined)) {
    patch.name = resolved.name;
  }
  if (resolved.phone && resolved.phone !== (current.phone ?? undefined)) {
    patch.phone = resolved.phone;
  }
  return patch;
}

/**
 * Format a real phone number for display.
 * - Italian numbers (prefix "39") → "+39 347 843 5299" style.
 * - Everything else → "+<number>".
 * Input is the digits-only number (no "+", no suffix).
 */
export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return phone;
  if (digits.startsWith("39") && digits.length > 2) {
    const rest = digits.slice(2);
    // Group as 3-3-rest (e.g. 347 843 5299) for readability.
    const groups: string[] = [];
    if (rest.length > 6) {
      groups.push(rest.slice(0, 3), rest.slice(3, 6), rest.slice(6));
    } else if (rest.length > 3) {
      groups.push(rest.slice(0, 3), rest.slice(3));
    } else {
      groups.push(rest);
    }
    return `+39 ${groups.join(" ")}`;
  }
  return `+${digits}`;
}

/**
 * Display label for a contact in the inbox.
 * - Prefer the resolved name.
 * - Else the formatted real phone.
 * - Else fall back to the raw waId (legacy display) prefixed with "+".
 */
export function contactDisplayName(c: {
  name?: string | null;
  phone?: string | null;
  waId: string;
}): string {
  if (c.name && c.name.trim()) return c.name.trim();
  if (c.phone) return formatPhone(c.phone);
  return `+${c.waId}`;
}

/**
 * Secondary line (the phone) for a contact.
 * - The formatted real phone when known.
 * - Else, only when there is also no name, fall back to the raw waId.
 * - Returns null when a name is shown but no real phone resolved (avoid
 *   leaking the raw @lid digits next to a real name).
 */
export function contactPhoneLine(c: {
  name?: string | null;
  phone?: string | null;
  waId: string;
}): string | null {
  if (c.phone) return formatPhone(c.phone);
  if (c.name && c.name.trim()) return null;
  return `+${c.waId}`;
}

/**
 * Reconstruct candidate WhatsApp ids (with suffix) for backfill resolution from
 * a suffix-stripped waId. Long privacy ids are `@lid` first; short phone-like
 * ids are `@c.us` first. Both forms are tried in order.
 */
export function candidateContactIds(waId: string): string[] {
  // Group ids keep their suffix in waId; never resolve those.
  if (waId.includes("@")) return [];
  // Real phone numbers (E.164) are short (≤13 digits incl. country code);
  // privacy @lid ids are long (14+ digits). Try the more likely suffix first.
  const looksLikePhone = /^\d{8,13}$/.test(waId);
  return looksLikePhone ? [`${waId}@c.us`, `${waId}@lid`] : [`${waId}@lid`, `${waId}@c.us`];
}
