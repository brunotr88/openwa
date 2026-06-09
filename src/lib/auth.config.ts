/**
 * Edge-safe NextAuth config — imported by middleware only.
 * Must NOT import bcryptjs, Prisma, or any Node-only module.
 */
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const authConfig: NextAuthConfig = {
  // Required behind a reverse proxy (Coolify/Traefik) — without it NextAuth v5
  // throws UntrustedHost: "Host must be trusted" on every auth request.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isAuthRoute =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/api/auth");
      const isPublicApi =
        nextUrl.pathname.startsWith("/api/health");

      if (isAuthRoute || isPublicApi) return true;
      if (isLoggedIn) return true;

      return Response.redirect(new URL("/login", nextUrl));
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
  providers: [
    // Credentials provider registered here as placeholder for edge config;
    // actual authorize logic is in auth.ts (Node runtime).
    Credentials({
      credentials: {
        email: {},
        password: {},
        totp: {},
      },
      async authorize() {
        // Intentionally null here — real logic in auth.ts
        return null;
      },
    }),
  ],
};
