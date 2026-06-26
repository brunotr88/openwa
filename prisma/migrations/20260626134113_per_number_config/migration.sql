-- DropIndex
DROP INDEX "AiConfig_tenantId_key";

-- AlterTable
ALTER TABLE "WaSession" ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "AiConfig" ADD COLUMN     "sessionId" TEXT;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "sessionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AiConfig_sessionId_key" ON "AiConfig"("sessionId");

-- AddForeignKey
ALTER TABLE "AiConfig" ADD CONSTRAINT "AiConfig_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WaSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

