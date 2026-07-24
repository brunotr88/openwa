-- DropIndex
DROP INDEX "Template_tenantId_name_key";

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "replyingAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WebhookDelivery_createdAt_idx" ON "WebhookDelivery"("createdAt");

-- Indici unici PARZIALI (prisma migrate diff non li genera — vedi FIX 1 e FIX 4).

-- FIX 1: evita Conversation OPEN duplicate per (sessionId, contactId) sotto race
-- (findFirst+create concorrenti su webhook/enqueue).
CREATE UNIQUE INDEX "Conversation_open_uniq" ON "Conversation"("sessionId","contactId") WHERE status = 'OPEN' AND "deletedAt" IS NULL;

-- FIX 4a: sostituisce il vecchio @@unique([tenantId, name]) totale (droppato sopra),
-- che bloccava la ricreazione di un Template dopo soft-delete.
CREATE UNIQUE INDEX "Template_tenantId_name_active" ON "Template"("tenantId","name") WHERE "deletedAt" IS NULL;
