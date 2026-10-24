\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

WITH restored AS (
  UPDATE "Message" m
  SET key = b.key
  FROM "_lid_remote_jid_alt_backup" b
  WHERE b.id = m.id
  RETURNING m.id
)
SELECT count(*) AS restored_rows FROM restored;

DROP TABLE "_lid_remote_jid_alt_backup";

COMMIT;
