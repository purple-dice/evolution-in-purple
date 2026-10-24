\set ON_ERROR_STOP on
BEGIN;

WITH lid_phone_map AS (
  SELECT "instanceId", key->>'remoteJid' AS lid, min(key->>'remoteJidAlt') AS phone_jid
  FROM "Message"
  WHERE key->>'remoteJid' LIKE '%@lid'
    AND key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
  GROUP BY "instanceId", key->>'remoteJid'
  HAVING count(DISTINCT key->>'remoteJidAlt') = 1
),
updated AS (
  UPDATE "Message" m
  SET key = jsonb_set(m.key, '{remoteJidAlt}', to_jsonb(p.phone_jid), true)
  FROM lid_phone_map p
  WHERE p."instanceId" = m."instanceId"
    AND p.lid = m.key->>'remoteJid'
    AND m.key->>'remoteJid' LIKE '%@lid'
    AND coalesce(m.key->>'remoteJidAlt', '') NOT LIKE '%@s.whatsapp.net'
    AND p.phone_jid LIKE '%@s.whatsapp.net'
  RETURNING m.id
)
SELECT count(*) AS updated_rows FROM updated;

WITH ambiguous AS (
  SELECT "instanceId", key->>'remoteJid' AS lid
  FROM "Message"
  WHERE key->>'remoteJid' LIKE '%@lid'
    AND key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
  GROUP BY "instanceId", key->>'remoteJid'
  HAVING count(DISTINCT key->>'remoteJidAlt') > 1
)
SELECT count(*) AS ambiguous_lids_skipped FROM ambiguous;

COMMIT;
