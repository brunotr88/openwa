-- FIX F: idempotenza enqueue di campagna — un contatto non può essere
-- accodato due volte per la stessa campagna (ri-lanci sicuri). I job non di
-- campagna hanno campaignId NULL: in Postgres i NULL multipli non violano
-- un indice unico, quindi l'enqueue via API (campaignId assente) resta libero.
CREATE UNIQUE INDEX "OutboundJob_campaignId_contactId_key" ON "OutboundJob"("campaignId", "contactId");

-- FIX D: idempotenza creazione campagna — nome univoco per tenant tra le
-- campagne non cancellate (Campaign ha già "deletedAt"). Indice PARZIALE
-- (scritto a mano, non generabile da `prisma migrate diff` sul datamodel)
-- perché una campagna cancellata non deve bloccare il riuso del nome.
CREATE UNIQUE INDEX "Campaign_tenantId_name_active" ON "Campaign"("tenantId", "name") WHERE "deletedAt" IS NULL;
