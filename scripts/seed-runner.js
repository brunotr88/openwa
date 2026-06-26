/**
 * Idempotent seed (plain JS — runs at container start without a TS runtime).
 * Creates: admin User, demo Tenant, UserTenant link.
 * Backfills per-number config (WaSession.settings, AiConfig.sessionId, ApiKey.sessionId).
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME from env.
 */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const db = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME || "Admin";

  if (!email || !password) {
    console.warn("[seed] ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping seed.");
    return;
  }

  // Demo tenant (idempotent on unique slug).
  const tenant = await db.tenant.upsert({
    where: { slug: "demo" },
    update: {},
    create: { name: "Demo", slug: "demo", status: "ACTIVE" },
  });

  // Admin user (idempotent on unique email). Hash only on create.
  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    const passwordHash = await bcrypt.hash(password, 12);
    user = await db.user.create({
      data: { email, name, passwordHash, role: "ADMIN" },
    });
    console.log(`[seed] Created admin user ${email}`);
  } else {
    console.log(`[seed] Admin user ${email} already exists`);
  }

  // Membership link (idempotent on unique [userId, tenantId]).
  await db.userTenant.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    update: {},
    create: { userId: user.id, tenantId: tenant.id, role: "ADMIN" },
  });

  await backfillPerNumberConfig(db);

  console.log("[seed] Done.");
}

// --- Backfill per-number config (idempotente) ---
async function backfillPerNumberConfig(db) {
  function pickPrimary(sessions) {
    if (!sessions.length) return null;
    const byNewest = [...sessions].sort((a, b) => b.createdAt - a.createdAt);
    return (byNewest.find((s) => s.status === "CONNECTED") ?? byNewest[0]).id;
  }
  const tenants = await db.tenant.findMany({ select: { id: true, settings: true } });
  for (const t of tenants) {
    const sessions = await db.waSession.findMany({
      where: { tenantId: t.id, deletedAt: null },
      select: { id: true, status: true, createdAt: true, settings: true },
    });
    if (!sessions.length) continue;
    for (const s of sessions) {
      if (s.settings == null && t.settings != null) {
        await db.waSession.update({ where: { id: s.id }, data: { settings: t.settings } });
      }
    }
    const primaryId = pickPrimary(sessions);
    const orphan = await db.aiConfig.findFirst({ where: { tenantId: t.id, sessionId: null } });
    if (orphan && primaryId) {
      const taken = await db.aiConfig.findUnique({ where: { sessionId: primaryId } });
      if (!taken) {
        await db.aiConfig.update({ where: { id: orphan.id }, data: { sessionId: primaryId } });
      }
    }
    for (const s of sessions) {
      const has = await db.aiConfig.findUnique({ where: { sessionId: s.id } });
      if (!has) {
        await db.aiConfig.create({ data: { tenantId: t.id, sessionId: s.id } });
      }
    }
    if (primaryId) {
      await db.apiKey.updateMany({
        where: { tenantId: t.id, sessionId: null, deletedAt: null },
        data: { sessionId: primaryId },
      });
    }
  }
  console.log("[seed] backfill per-number config: done");
}

main()
  .catch((e) => {
    console.error("[seed] Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
