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

3. Apply (single transaction, prints `updated_rows`, `changed_meanwhile_rows_skipped` and `ambiguous_lids_skipped`). Before updating, it copies
   the original `(id, key)` of every row it is about to change into `"_lid_remote_jid_alt_backup"` (created if
   missing; on re-runs the first saved original wins). It runs with `lock_timeout = '5s'` and
   `statement_timeout = '10min'` so it fails fast instead of blocking live writes; on a timeout nothing is
   committed and it can simply be re-run. Updated rows stay locked until the transaction commits, so live status
   updates on those rows wait for it; run it during low traffic. Measured candidates are about 20k rows per
   database, which commits in seconds:

   ```bash
   psql "$DATABASE_CONNECTION_URI" -f scripts/backfill-lid-remote-jid-alt/apply.sql
   ```

4. Verify: run the dry run again. `fixable_rows` must be 0; running `apply.sql` again must print `updated_rows = 0`. Rows changed by Evolution while the script ran are skipped (`changed_meanwhile_rows_skipped`); run it again to pick them up.

## Rollback

Precise rollback from the backup table (single transaction: restores `key` for every backed-up id, prints
`restored_rows`, then drops `"_lid_remote_jid_alt_backup"`):

```bash
psql "$DATABASE_CONNECTION_URI" -f scripts/backfill-lid-remote-jid-alt/rollback.sql
```

Rollback replaces the whole `key` of each backed-up row, so any change made to those keys after `apply.sql`
(for example a status update) is lost. Roll back soon after applying, or not at all.

The full `pg_dump` from step 1 remains the last-resort backup; restore individual rows from it rather than
dropping and recreating `"Message"`.

Once the backfill is verified and no rollback is needed, drop the backup table manually:

```sql
DROP TABLE "_lid_remote_jid_alt_backup";
```
