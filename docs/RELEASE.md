# PhoneDex release provenance

PhoneDex keeps the bridge and native iPhone release identity in the repository
so a build can be traced without putting credentials or task content in a
manifest. `VERSION` and `BUILD_NUMBER` are the canonical release identity. The
iOS app and notification extension use the same version and build number
through the generated Xcode project.

Run the release checks from a clean checkout:

```sh
npm run release:verify
npm run release:manifest > release-manifest.json
npm run test:release-signing-preflight
```

The manifest uses the current Git revision, reports whether the source tree was
dirty, records the protocol and supported Node versions, and identifies the
iOS deployment target. It contains no hub URL, token, pairing credential,
workspace path, task text, or signing secret. The `signing` field deliberately
records the release-owner gate; it does not claim that unsigned simulator CI
proves signing or entitlements.

The native Settings About section reads `CFBundleShortVersionString` and
`CFBundleVersion` from the app bundle, displaying the same release identity as
the generated project. If either value is unavailable, it uses a safe
development label rather than presenting a stale hard-coded version.

When `ios/project.yml` changes, regenerate the committed project before
running the verifier:

```sh
npm run ios:generate
npm run release:verify
```

Apple signing, TestFlight, real-device validation, and final App Store privacy
decisions remain release-owner work and are not automated by this manifest.
Use [`docs/REAL_DEVICE_VALIDATION.md`](REAL_DEVICE_VALIDATION.md) to record
those manual results without weakening the local-first security boundary.

The signing preflight checks that the app and notification extension retain
their expected bundle identifiers and development team, that the generated
Xcode project agrees with `ios/project.yml`, and that provisioning profiles,
entitlement paths, and APNs environment values are not committed. It emits a
content-free `phonedex.signing-preflight.v1` report with a
`ready-for-release-owner-signing` status. This is a reproducibility and drift
guard; it does not sign an archive or replace the human signing/TestFlight
decision tracked in issue #132.

For a network-reachable hub or agent, configure TLS before release:

```sh
PHONEDEX_REQUIRE_TLS=true
PHONEDEX_TLS_CERT_FILE=/path/to/certificate.pem
PHONEDEX_TLS_KEY_FILE=/path/to/private-key.pem
WATCH_BRIDGE_PUBLIC_URL=https://bridge.example.test:8765
```

The bridge fails closed when the required setting is enabled without an HTTPS
public URL, when certificate and key configuration is incomplete, or when an
HTTPS URL has missing, empty, or unreadable certificate files. Loopback HTTP
remains available for local development. Certificate provisioning, rotation,
and deployment are operator/release-owner responsibilities; private keys are
never included in PhoneDex reports or diagnostics.

Legacy query-token compatibility is disabled by default. Production clients
must use the `Authorization: Bearer` header with a scoped identity or the
existing short-lived agent invite flow; credentials are not emitted in
bootstrap URLs or support output. Set
`PHONEDEX_ENABLE_LEGACY_QUERY_TOKENS=true` only for a time-bounded migration
of older local tooling, and remove it before external beta. Legacy form-body
authentication is also disabled by default; set
`PHONEDEX_ENABLE_LEGACY_BODY_TOKENS=true` only for a time-bounded migration
of older local tooling, and remove it before external beta. Setting either
flag while `NODE_ENV=production` or `PHONEDEX_PRODUCTION=true` makes the hub
fail closed at startup, preventing a production deployment from accidentally
reintroducing credential-bearing URLs or request bodies.

The native Settings surface presents one-time secure pairing as the primary
credential path. A migrated legacy token can still be entered for a local
compatibility transition, but only through the explicitly labeled legacy
disclosure; it remains in the device-only Keychain and is not copied into URLs,
notifications, or support diagnostics. Production hub deployments still reject
legacy query and form-body token compatibility unless the fail-closed rules
documented above are changed by an approved release owner.

The 15 product acceptance scenarios have a separate, content-free evidence
contract. Validate a release-owner evidence file with:

```sh
npm run acceptance:verify -- --input ./acceptance-evidence.json --output ./acceptance-report.json
```

Each scenario record contains only its stable id, pass/fail/not-run status,
supported platform names, and a recent UTC validation timestamp. The validator
rejects missing, duplicate, unknown, stale, future-dated, unsupported-platform,
and oversized reports. A passing report proves only that the evidence is
complete and current enough to review; it does not replace real-device
execution, signing, TestFlight, APNs, privacy, or release-owner approval.

The combined M8 quality gate has a separate content-free evidence contract for
performance, battery, accessibility, localization, and crash validation:

```sh
npm run quality:verify -- --input ./quality-gates.json --output ./quality-report.json
```

Each report also records the full checked-out source revision. Each record contains only a stable gate id, pass/fail/not-run status, supported
platform names, a UTC validation timestamp, and a bounded evidence id. The
validator requires performance evidence on iOS, macOS, and Windows, and
requires every other native gate on iOS. It rejects missing, duplicate, stale,
future-dated, unsupported, or over-broad platform evidence, along with
additional fields, so task content, credentials, paths, and screenshots cannot
be smuggled into a release report.
A report without a full source revision, or one supplied to the CLI that does
not match the checked-out revision, fails closed. This keeps evidence tied to
the code that produced it without storing task content or credentials.
A passing report makes evidence reviewable;
it does not claim that simulator checks replace real-device profiling or
release-owner approval.

Both validators print the normalized report and, when `--output` is supplied,
write the same content-free JSON to that path with restrictive local file
permissions. A failed validation still writes its report before returning a
non-zero exit code, so CI can preserve actionable evidence without treating a
failed gate as a release approval.

The crash gate also has a native runtime regression: the
`PhoneDexAppModelRecoveryTests` unit test injects a failing encrypted-cache
load and verifies that startup quarantines the cache, exposes no untrusted
tasks, devices, or events, and remains ready for a fresh foreground sync. This
complements the source-level `npm run test:ios-crash-recovery` contract check;
neither check claims to replace real-device crash and disk-failure validation.
