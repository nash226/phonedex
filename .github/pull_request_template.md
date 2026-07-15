## Scope

- [ ] This change implements exactly one independently reviewable roadmap slice.
- Roadmap slice: <!-- link to the checked item in docs/ROADMAP.md -->
- User-facing outcome: <!-- describe the behavior or safety improvement -->

## Product and compatibility

- [ ] `docs/PRODUCT.md`, `docs/ROADMAP.md`, and the implementation agree.
- [ ] The change preserves the local-first hub and per-computer agent model.
- [ ] Mac and Windows behavior is explicit where it differs.
- [ ] No undocumented private Codex Desktop API or UI automation dependency was added.

## Validation evidence

List the exact commands, simulator/device, and results. If a check does not
apply, explain why.

- Node: `<!-- npm run check / npm test / focused test -->`
- iOS: `<!-- xcodebuild command, destination, and test/build result -->`
- Manual: `<!-- workflow, platform, or accessibility check -->`

## Reliability and UX review

- [ ] Loading, empty, error, stale/offline, and partial-failure states are handled or not applicable with an explanation.
- [ ] Drafts, retries, duplicate delivery, and reconnect behavior are handled or not applicable with an explanation.
- [ ] Dynamic Type, VoiceOver labels/traits, Reduce Motion, and dark/light appearance were reviewed for affected UI.
- [ ] Actions preserve task identity, machine, workspace, and freshness context.

## Security and privacy review

- [ ] Credentials, tokens, source content, and sensitive task data are not added to URLs, logs, notifications, analytics, or support output.
- [ ] Permissions, transport, retention, and redaction effects were reviewed.
- [ ] New commands are scoped, auditable, idempotent, and capability-gated, or are not applicable.

## Human decision gate

- [ ] No human decision is required for this change.
- [ ] A `needs-human-decision` issue is linked below with the exact decision, options, recommendation, consequences of delay, and unblocking condition.

Decision issue: <!-- #123, or "Not applicable" -->

## Reviewer focus

<!-- Call out the highest-risk files, behavior, or follow-up decision. -->
