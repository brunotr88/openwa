/**
 * Edge-safe NextAuth config — imported by middleware only.
 * Must NOT import bcryptjs, Prisma, or any Node-only module.
 */
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

/** 401 JSON — usato per le rotte API al posto del redirect verso /login. */
function unauthorized(reason = "unauthorized"): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

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
    authorized({ auth, request }) {
      const { nextUrl, headers } = request;
      const isLoggedIn = !!auth?.user;
      const isAuthRoute =
        nextUrl.pathname.startsWith("/login") ||
        nextUrl.pathname.startsWith("/api/auth");

      // Health check: pubblico by design, non ritorna dati.
      if (nextUrl.pathname.startsWith("/api/health")) return true;

      // Le tre famiglie di API senza sessione hanno ciascuna la propria
      // autenticazione dentro la route. La whitelist qui è però per PREFISSO:
      // una route aggiunta domani sotto questi path che dimenticasse il proprio
      // check sarebbe pubblica su Internet senza che nulla lo segnali.
      // Difesa in profondità: qui pretendiamo almeno la PRESENZA della
      // credenziale attesa, così un endpoint dimenticato fallisce chiuso.
      // NB: non validiamo il valore (il middleware gira su edge runtime, senza
      // accesso al DB): la verifica vera resta nella route.
      if (nextUrl.pathname.startsWith("/api/webhooks/wa")) {
        return headers.has("x-openwa-signature")
          ? true
          : unauthorized("missing signature");
      }
      if (nextUrl.pathname.startsWith("/api/v1/")) {
        return headers.has("x-api-key") ? true : unauthorized("missing api key");
      }
      if (nextUrl.pathname.startsWith("/api/internal/")) {
        return headers.has("authorization")
          ? true
          : unauthorized("missing authorization");
      }

      if (isAuthRoute) return true;
      if (isLoggedIn) return true;

      // Un client API non deve ricevere un redirect HTML alla pagina di login:
      // maschera gli errori di autenticazione e rende illeggibili i log.
      if (nextUrl.pathname.startsWith("/api/")) return unauthorized();

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
