/**
 * Idempotent seed (plain JS — runs at container start without a TS runtime).
 * Creates: admin User, demo Tenant, UserTenant link, default AiConfig.
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

  // Default AI config for the demo tenant (idempotent on unique tenantId).
  await db.aiConfig.upsert({
    where: { tenantId: tenant.id },
    update: {},
    create: {
      tenantId: tenant.id,
      provider: "BEDROCK",
      modelId: "eu.anthropic.claude-sonnet-4-5-20250929-v1:0",
      systemPrompt: "Sei un assistente WhatsApp cortese e conciso.",
      temperature: 0.7,
      autoReplyEnabled: false,
    },
  });

  console.log("[seed] Done.");
}

main()
  .catch((e) => {
    console.error("[seed] Error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
