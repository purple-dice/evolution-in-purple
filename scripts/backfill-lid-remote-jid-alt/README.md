# Backfill `key.remoteJidAlt` for `@lid` messages

One-off, idempotent, operator-run PostgreSQL script. Inspired by upstream EvolutionAPI/evolution-api#2663 by @fidelis05.

## Purpose

Older `"Message"` rows (history-sync shaped) have `key.remoteJid = "<digits>@lid"` and no `key.remoteJidAlt`.
Live messages from the same contact usually carry `key.remoteJidAlt = "<phone>@s.whatsapp.net"`. This script
copies that phone JID onto the older rows of the **same `instanceId`** and the same `key.remoteJid`.

Guarantees:

- It **never changes `key.remoteJid`**. Only `key.remoteJidAlt` is written.
- It writes only when `key.remoteJidAlt` is missing, empty or not a phone JID, and only with a value ending in `@s.whatsapp.net`.
- Mappings never cross instances.
- A lid that maps to more than one distinct phone within an instance is skipped and counted.
- Re-running it updates 0 rows.

PostgreSQL only.

## Steps

1. Back up the table first:

   ```bash
   pg_dump "$DATABASE_CONNECTION_URI" -t '"Message"' -Fc -f message-backup.dump
   ```

2. Dry run (read-only). Reports candidate rows, fixable rows, rows with a non-phone `remoteJidAlt`
   (these are replaced when fixable), ambiguous lids, and the top 10 instances by fixable rows:

   ```bash
   psql "$DATABASE_CONNECTION_URI" -f scripts/backfill-lid-remote-jid-alt/dry-run.sql
   ```

3. Apply (single transaction, prints `updated_rows` and `ambiguous_lids_skipped`):

   ```bash
   psql "$DATABASE_CONNECTION_URI" -f scripts/backfill-lid-remote-jid-alt/apply.sql
   ```

4. Verify: run the dry run again. `fixable_rows` must be 0; running `apply.sql` again must print `updated_rows = 0`.

## Rollback

Restore the backup taken in step 1 (for example with `pg_restore --clean -t Message -d "$DATABASE_CONNECTION_URI"
message-backup.dump`).
