\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE TABLE IF NOT EXISTS "_lid_remote_jid_alt_backup" (
  id text PRIMARY KEY,
  key jsonb NOT NULL,
  backed_up_at timestamp DEFAULT now()
);

CREATE TEMP TABLE lid_backfill_targets ON COMMIT DROP AS
WITH lid_phone_map AS (
  SELECT "instanceId", key->>'remoteJid' AS lid, min(key->>'remoteJidAlt') AS phone_jid
  FROM "Message"
  WHERE key->>'remoteJid' LIKE '%@lid'
    AND key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
  GROUP BY "instanceId", key->>'remoteJid'
  HAVING count(DISTINCT key->>'remoteJidAlt') = 1
)
SELECT m.id, m.key AS original_key, p.phone_jid
FROM "Message" m
JOIN lid_phone_map p ON p."instanceId" = m."instanceId" AND p.lid = m.key->>'remoteJid'
WHERE m.key->>'remoteJid' LIKE '%@lid'
  AND coalesce(m.key->>'remoteJidAlt', '') NOT LIKE '%@s.whatsapp.net'
  AND p.phone_jid LIKE '%@s.whatsapp.net';

INSERT INTO "_lid_remote_jid_alt_backup" (id, key)
SELECT id, original_key FROM lid_backfill_targets
ON CONFLICT (id) DO NOTHING;

WITH updated AS (
  UPDATE "Message" m
  SET key = jsonb_set(m.key, '{remoteJidAlt}', to_jsonb(t.phone_jid), true)
  FROM lid_backfill_targets t
  WHERE t.id = m.id
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
