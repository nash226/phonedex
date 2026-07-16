# PhoneDex migration and recovery runbook

This runbook covers the local hub data directory. It is a release gate for
upgrades because the transactional store protects the main snapshot, while
compatibility logs and exported artifacts remain sibling files that must be
backed up together.

## Before a staged upgrade

1. Stop the hub and every agent writing the data directory. Do not copy a live
   directory while a request or watcher can still append a record.
2. Copy the complete configured `PHONEDEX_DATA_DIR` to protected storage,
   preserving file permissions. The copy must include
   `phonedex-store.json`, `phonedex-store.json.bak`, legacy JSONL/device
   mirrors, command and receipt logs, security/privacy audit logs, and the
   artifact directory when present.
3. Record the source revision, PhoneDex version, backup location, and a
   content-free file inventory. Never paste task content, credentials, or
   local paths into a ticket.
4. Run `npm run test:recovery` from the candidate revision before opening the
   data directory to the upgraded hub.

## Staged migration

Start with a copy of the backup on one hub. Verify that the store reaches the
current schema version, legacy files remain readable, expected device coverage
is present, and a snapshot-plus-cursor sync completes. Keep the previous hub
available until smoke checks pass for task reads, reply receipts, device
health, and approval state.

Stop and restore the backup if the migration reports an unsupported future
version, loses a task/device/event, changes command or receipt counts, fails
cursor continuity, or exposes a credential/path in a public projection. Do not
delete legacy files during this stage; they are compatibility evidence and a
rollback aid.

## Rollback and disaster recovery

1. Stop all writers and preserve the failed directory as evidence. Do not
   overwrite it.
2. Point the previous known-good PhoneDex build at a fresh copy of the
   protected backup. Restore the complete directory, not only
   `phonedex-store.json`; command/receipt logs and artifact metadata are part
   of the recovery unit.
3. Start the hub read-only for smoke checks, then verify authenticated sync,
   identity status, task versions, pending commands, terminal receipts, and
   device reachability before allowing writes.
4. Re-run `npm run test:recovery` and the full `npm test` suite. Record the
   recovery result and any bounded data loss explicitly before resuming agents.

The store's `.bak` file is an immediate corruption fallback, not a substitute
for a complete operator backup. It may intentionally lag the latest
transaction, and confirmed history deletion removes it so deleted task
content is not left recoverable there. Protect complete backups as sensitive
local data; PhoneDex does not upload them or provide a hosted recovery service.
