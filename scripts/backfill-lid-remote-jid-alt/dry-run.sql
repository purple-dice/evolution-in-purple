WITH lid_phone_map AS (
  SELECT "instanceId", key->>'remoteJid' AS lid, count(DISTINCT key->>'remoteJidAlt') AS phone_count
  FROM "Message"
  WHERE key->>'remoteJid' LIKE '%@lid'
    AND key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
  GROUP BY "instanceId", key->>'remoteJid'
),
candidates AS (
  SELECT m."instanceId", key->>'remoteJid' AS lid, coalesce(key->>'remoteJidAlt', '') = '' AS alt_missing
  FROM "Message" m
  WHERE key->>'remoteJid' LIKE '%@lid'
    AND coalesce(key->>'remoteJidAlt', '') NOT LIKE '%@s.whatsapp.net'
)
SELECT
  (SELECT count(*) FROM candidates) AS candidate_rows,
  (SELECT count(*) FROM candidates c JOIN lid_phone_map p USING ("instanceId", lid)
    WHERE p.phone_count = 1) AS fixable_rows,
  (SELECT count(*) FROM candidates WHERE NOT alt_missing) AS non_phone_alt_rows,
  (SELECT count(*) FROM lid_phone_map WHERE phone_count > 1) AS ambiguous_lids,
  (SELECT count(*) FROM candidates c JOIN lid_phone_map p USING ("instanceId", lid)
    WHERE p.phone_count > 1) AS ambiguous_rows_skipped;

WITH lid_phone_map AS (
  SELECT "instanceId", key->>'remoteJid' AS lid, count(DISTINCT key->>'remoteJidAlt') AS phone_count
  FROM "Message"
  WHERE key->>'remoteJid' LIKE '%@lid'
    AND key->>'remoteJidAlt' LIKE '%@s.whatsapp.net'
  GROUP BY "instanceId", key->>'remoteJid'
)
SELECT m."instanceId", count(*) AS fixable_rows
FROM "Message" m
JOIN lid_phone_map p ON p."instanceId" = m."instanceId" AND p.lid = m.key->>'remoteJid'
WHERE p.phone_count = 1
  AND coalesce(m.key->>'remoteJidAlt', '') NOT LIKE '%@s.whatsapp.net'
GROUP BY m."instanceId"
ORDER BY fixable_rows DESC
LIMIT 10;
