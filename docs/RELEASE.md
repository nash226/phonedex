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
