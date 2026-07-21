# PhoneDex Native Crash-Recovery Contract

PhoneDex treats encrypted local cache data as an optimization, never as the
source of truth. A malformed or unreadable cache must not prevent the native
iPhone shell from launching or from performing a fresh hub sync.

## Cold-start behavior

1. The app attempts to decode the encrypted cache behind a throwing boundary.
2. A successful decode restores only the bounded, schema-validated projection.
3. A failed decode starts with an empty trusted projection and shows generic
   recovery guidance. The app never displays partially decoded tasks, devices,
   events, drafts, replies, or artifacts.
4. The app moves the unreadable file to a generated `*.corrupt-<UUID>` name
   while preserving the device-only encryption key.
5. If quarantine itself fails, a non-sensitive local bypass marker prevents the
   next cold launch from retrying the same unreadable file indefinitely. The
   marker is cleared only after a complete hub sync rebuilds the projection.

The bypass marker contains no task content, credentials, paths, or remote
identifiers. It does not delete the cache or claim that the hub history was
changed. Real-device crash-free, disk-failure, notification-action, and
background-execution validation remain release-owner gates.

## Evidence

- `PhoneDexAppModelRecoveryTests` covers empty trusted state after decode
  failure, successful-sync recovery, and quarantine-failure relaunch safety.
- `scripts/test-ios-crash-recovery.js` protects the source-level quarantine and
  generic-copy contract in CI.
- The iOS simulator test action validates the runtime test target; it does not
  substitute for signed real-device release validation.
