# PhoneDex Recovery Drill

This runbook covers the local hub data path. It is intentionally limited to
user-owned files and does not require a hosted relay, Apple credentials, or a
private Codex Desktop API.

## Recovery contract

The hub imports legacy `tasks.jsonl` and `devices.json` files into the versioned
`phonedex-store.json` snapshot without deleting the legacy files. Each
successful transaction atomically replaces the primary snapshot and retains
the previous valid snapshot as `phonedex-store.json.bak`. If the primary is
invalid, the hub restores the backup, renames the invalid primary to a
timestamped `phonedex-store.json.corrupt-*` file, and continues. A store with
a newer unsupported version fails closed instead of being downgraded.

The backup is a rollback safety net, not a general archive. It contains the
previous transaction only; operators should copy the data directory before
manual maintenance and keep it private because it contains task content.

## Deterministic drill

From the repository root, run:

```sh
npm run test:recovery-drill
```

The drill verifies staged legacy migration, backup creation, corrupt-primary
rollback in a fresh Node process, post-recovery writes, restart persistence,
and fail-closed handling of a future store version. The fixture uses temporary
directories and removes them after the run.

## Operator procedure

1. Stop the hub and agent services before copying or inspecting the data
   directory.
2. Make a private copy of the entire configured data directory, including the
   durable store, backup, legacy mirrors, artifacts, and audit files.
3. Restart the hub. If the primary snapshot is corrupt but its backup is
   valid, startup performs the documented rollback and quarantines the bad
   primary.
4. Run `npm run test:recovery-drill` from a clean checkout to validate the
   installed runtime and store contract.
5. Confirm `/sync` shows the expected task/device projection, then resume
   agents one at a time and verify their heartbeats.
6. If startup reports an unsupported future store version, stop and preserve
   the data directory. Do not edit the version or delete the backup; use the
   release that understands that version or escalate to the release owner.

Recovery does not recreate data that was never committed, restore deleted
history after a confirmed privacy deletion, or repair a damaged backup. Those
cases require the preserved copy and a human-reviewed recovery plan.
