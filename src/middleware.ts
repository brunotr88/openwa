/**
 * Edge middleware — imports ONLY auth.config.ts (edge-safe).
 * Blueprint §3: never import auth.ts / bcrypt / Prisma here.
 */
import NextAuth from "next-auth";
import { authConfig } from "./lib/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  // Run on everything except static assets and image optimizer.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
