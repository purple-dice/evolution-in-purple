-- CreateTable
CREATE TABLE "IsOnWhatsappJid" (
    "jid" VARCHAR(100) NOT NULL,
    "remoteJid" VARCHAR(100) NOT NULL,
    "lid" VARCHAR(100),
    "updatedAt" TIMESTAMP NOT NULL,

    CONSTRAINT "IsOnWhatsappJid_pkey" PRIMARY KEY ("jid")
);

-- CreateIndex
CREATE INDEX "IsOnWhatsappJid_remoteJid_idx" ON "IsOnWhatsappJid"("remoteJid");

-- Backfill from IsOnWhatsapp, one row per jid option
INSERT INTO "IsOnWhatsappJid" ("jid", "remoteJid", "lid", "updatedAt")
SELECT DISTINCT ON ("jid") "jid", "remoteJid", "lid", "updatedAt"
FROM (
  SELECT trim(option) AS "jid", o."remoteJid", o."lid", o."updatedAt"
  FROM "IsOnWhatsapp" o
  CROSS JOIN LATERAL unnest(string_to_array(o."jidOptions", ',') || o."remoteJid") AS option
) expanded
WHERE "jid" <> ''
  AND length("jid") <= 100
  AND length("jid") - length(replace("jid", '@', '')) <= 1
  AND "jid" NOT LIKE '%@undefined'
ORDER BY "jid", "updatedAt" DESC
ON CONFLICT ("jid") DO NOTHING;
