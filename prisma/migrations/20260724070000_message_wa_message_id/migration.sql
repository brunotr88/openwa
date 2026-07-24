-- AlterTable: track gateway message id on OUT messages, to match message.ack
-- webhook events (DELIVERED/READ) back to the right Message row.
ALTER TABLE "Message" ADD COLUMN "waMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_waMessageId_key" ON "Message"("waMessageId");
