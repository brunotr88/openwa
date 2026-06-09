/**
 * Shared zod schemas (client + server). Blueprint §1: validation schema-first.
 */
import { z } from "zod";

/** Login form / credentials payload. */
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Password required"),
  totp: z.string().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Tenant AI configuration (settings/ai form + API). */
export const aiConfigSchema = z.object({
  provider: z.enum(["BEDROCK", "OPENAI"]),
  modelId: z.string().min(1),
  systemPrompt: z.string().max(8000).optional(),
  temperature: z.number().min(0).max(1),
  autoReplyEnabled: z.boolean(),
  businessHours: z
    .object({
      timezone: z.string(),
      days: z.array(z.number().int().min(0).max(6)),
      startHour: z.number().int().min(0).max(23),
      endHour: z.number().int().min(0).max(23),
    })
    .optional(),
});
export type AiConfigInput = z.infer<typeof aiConfigSchema>;
