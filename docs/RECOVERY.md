# PhoneDex Recovery Drill

This runbook validates recovery of the user-managed hub without contacting a
hosted service or deleting the original files. It applies to the shared Mac or
Windows-compatible Node hub and preserves task identity, command receipts, and
the encrypted iPhone cache as separate recovery concerns.

## Automated regression

Run the deterministic store drill from a clean checkout:

```sh
npm run test:recovery
```

The fixture proves that each committed snapshot has a previous `.bak` copy,
that a malformed current snapshot is archived and recovered automatically, and
that a snapshot from a newer unsupported version fails closed without being
overwritten.

## Operator drill

1. Stop the hub and agent processes using the platform service commands. Do not
   remove the data directory.
2. Copy the entire hub data directory to offline storage, preserving file
   permissions. Keep the original directory as the evidence source.
3. Record the hub version, Node.js version, data-directory path, and the last
   known task/device counts. Do not copy credentials into tickets or chat.
4. Start the hub once and inspect its health, device coverage, recent tasks,
   and command receipts. A malformed `phonedex-store.json` is moved to a
   timestamped `.corrupt-*` file and the last valid
   `phonedex-store.json.bak` is restored automatically.
5. If recovery succeeds, verify task identity, device identity, receipt status,
   and the iPhone's next foreground sync before resuming agents.
6. If the current snapshot declares a newer unsupported store version, stop and
   preserve the directory. Upgrade PhoneDex or follow the release-specific
   rollback plan; never replace a newer snapshot with an older one in place.
7. After the service is healthy, retain the original copy and recovery logs for
   the configured retention period, then apply the user's documented deletion
   policy.

The hub's transactional store is local-first: recovery restores the durable
hub projection, while the iPhone's device-only encrypted cache remains the
source for its pending outbox until the hub accepts those commands. Recovery
does not imply that a lost computer's private Codex session can be recreated.
