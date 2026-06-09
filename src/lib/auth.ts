/**
 * NextAuth v5 full config — Node runtime only.
 * Blueprint §3: bcrypt cost 12, lockout 5/15min, TOTP via otpauth.
 * DO NOT import this from middleware — use auth.config.ts instead.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import * as OTPAuth from "otpauth";
import { db } from "./db";
import { authConfig } from "./auth.config";
import { z } from "zod";
import { decryptString } from "./crypto";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().optional(),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        totp: { label: "2FA Code", type: "text" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;

        const { email, password, totp } = parsed.data;

        const user = await db.user.findUnique({ where: { email } });
        if (!user) return null;

        // Lockout check
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          return null;
        }

        const validPassword = await bcrypt.compare(password, user.passwordHash);
        if (!validPassword) {
          const attempts = user.failedAttempts + 1;
          await db.user.update({
            where: { id: user.id },
            data: {
              failedAttempts: attempts,
              lockedUntil:
                attempts >= MAX_FAILED_ATTEMPTS
                  ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
                  : null,
            },
          });
          return null;
        }

        // TOTP check (only if secret is set)
        if (user.totpSecret) {
          const decryptedSecret = decryptString(user.totpSecret);
          if (!decryptedSecret) return null;

          const otp = new OTPAuth.TOTP({
            secret: OTPAuth.Secret.fromBase32(decryptedSecret),
            algorithm: "SHA1",
            digits: 6,
            period: 30,
          });

          const delta = otp.validate({ token: totp ?? "", window: 1 });
          if (delta === null) return null;
        }

        // Reset failed attempts on success
        if (user.failedAttempts > 0) {
          await db.user.update({
            where: { id: user.id },
            data: { failedAttempts: 0, lockedUntil: null },
          });
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});
