// Prisma client singleton for the gateway.
//
// PRISMA APPROACH (documented):
// The single source-of-truth schema lives at the repo root: ../prisma/schema.prisma
// (the web service migrates against it). The gateway must generate its OWN client
// into gateway/node_modules/@prisma/client, but `prisma generate` resolves the
// output location by walking up from the schema's directory — pointing it at
// ../prisma/schema.prisma makes it write into the ROOT node_modules instead of
// the gateway's, leaving the gateway client uninitialized.
//
// Robust fix without touching the web schema's generator block: the
// `prisma:generate` npm script first SYNCS the root schema into ./prisma/schema.prisma
// (so resolution starts inside the gateway) then runs `prisma generate` on that
// copy. The copy is git-ignored and never hand-edited — it is regenerated from
// the root on every `prisma:generate`, so it cannot drift. We then import from
// "@prisma/client" normally.

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
