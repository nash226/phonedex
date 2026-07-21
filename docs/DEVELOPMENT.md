# PhoneDex Development Requirements

This guide is the supported development baseline for the current PhoneDex
bridge, native iPhone client, and Mac/Windows agents. It distinguishes versions
validated by repository CI from platform targets that still need manual
verification on the machine where they run.

## Supported matrix

| Component | Supported baseline | Validation and limits |
| --- | --- | --- |
| Node.js | 18.x and 22.x | Both versions run `npm run check` and `npm test` in GitHub Actions. Other Node versions at or above 18 may work, but are not release-validated. |
| npm | The npm version bundled with the selected Node.js release | The bridge has no runtime npm dependencies. Keep the Node/npm pair together rather than upgrading npm independently. |
| Xcode | 26.3 | The unsigned simulator workflow runs on the pinned `macos-15` GitHub Actions runner. Full Xcode is required; Command Line Tools alone are not enough. |
| iOS | 17.0 deployment target and later | The app and notification extension declare iOS 17.0. The supported test path is an iOS Simulator build/test with Xcode 26.3; signing is not required for simulator validation. |
| macOS | macOS Sequoia 15.6 or later for the native build flow | Xcode 26.3 is the repository's reproducible baseline. The Node hub/agent also requires a supported Node.js release; foreground reply submission additionally requires macOS Accessibility permission. |
| Windows | Windows 10 or later with Windows PowerShell 5.1 and Node.js 18.x or 22.x | The agent uses the built-in ScheduledTasks module. The installed task starts when available and retries a failed service up to five times at one-minute intervals. GitHub Actions validates the Windows adapter matrix, read-only task status, and disposable install/start/stop/remove lifecycle on `windows-latest` with Node 18.x and 22.x; session-file access and sleep/reconnect behavior still require manual validation on each supported Windows image. |
| XcodeGen | Current Homebrew package | Required only to regenerate `ios/PhoneDex.xcodeproj` from `ios/project.yml`; the generated project is committed for CI and clean checkouts. |

The repository does not promise support for private Codex Desktop APIs, remote
desktop control, or arbitrary platform versions outside this matrix.

## Reproducible checks

From the repository root, run the bridge checks with either supported Node.js
version:

```sh
npm run check
npm test
```

On a Mac with full Xcode 26.3 selected, inspect the toolchain and regenerate
the project only when `ios/project.yml` changes:

```sh
npm run ios:doctor
npm run ios:generate
```

The simulator build used by CI is:

```sh
xcodebuild \
  -project ios/PhoneDex.xcodeproj \
  -scheme PhoneDex \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build
```

For local unit and UI tests, select an installed iPhone simulator destination
from `xcodebuild -showdestinations`, then run the `PhoneDex` scheme's test
action. The project includes the `PhoneDexTests` and `PhoneDexUITests` targets
and requires no Apple signing credentials for simulator tests.

## Platform notes

- macOS hub and agents use the shell scripts and LaunchAgent integration in
  this repository. Foreground reply submission is an explicitly limited
  macOS fallback and needs Accessibility permission; it is not a cross-platform
  control contract.
- Windows agents use the PowerShell Scheduled Task integration. Keep the
  service under the same user that can read the local Codex session files, and
  run `npm run agent:self-test` after enrollment. The task is configured to
  start when a missed trigger becomes runnable and to retry a failed service
  up to five times at one-minute intervals; `npm run windows:status` reports
  that policy alongside the last task result. `npm run test:windows-adapter`
  validates CLI and app-server capability gates, Windows foreground fail-closed
  behavior, and the read-only Scheduled Tasks status path. The Windows CI job
  also runs `npm run test:windows-service-lifecycle`, which installs, starts,
  stops, and removes a disposable task before asserting that cleanup completed;
  it does not touch a developer's machine.
- The native iPhone app talks to a user-managed local hub or private network.
  Plaintext LAN URLs remain a development-only path; production transport and
  pairing requirements are tracked in M2 of the roadmap.

When a platform version falls outside this matrix, record the exact version,
command, and result before treating it as supported.
