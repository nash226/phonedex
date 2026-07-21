import XCTest
import Security
@testable import PhoneDex

@MainActor
final class PhoneDexSettingsTests: XCTestCase {
    func testCredentialSettingsLeadWithPairingAndBoundLegacyCompatibilityCopy() {
        XCTAssertEqual(PhoneDexCredentialCopy.pairingHeader, "Secure pairing")
        XCTAssertEqual(PhoneDexCredentialCopy.legacyHeader, "Legacy token compatibility")
        XCTAssertTrue(PhoneDexCredentialCopy.legacyWarning.contains("older local hub"))
        XCTAssertTrue(PhoneDexCredentialCopy.legacyFooter.contains("Keychain"))
        XCTAssertFalse(PhoneDexCredentialCopy.legacyFooter.contains("token is stored in URLs"))
    }

    func testReleaseIdentityDisplaysVersionAndBuild() {
        let identity = PhoneDexReleaseIdentity(version: "1.2.3", build: "42")

        XCTAssertEqual(identity.version, "1.2.3")
        XCTAssertEqual(identity.build, "42")
        XCTAssertEqual(identity.displayValue, "1.2.3 (42)")
    }

    func testReleaseIdentityUsesSafeFallbacksForMissingBundleValues() {
        let identity = PhoneDexReleaseIdentity(version: " ", build: nil)

        XCTAssertEqual(identity.version, "Development")
        XCTAssertEqual(identity.build, "")
        XCTAssertEqual(identity.displayValue, "Development")
    }

    func testNotificationBadgeCountsOnlyVisibleUnreadTasks() {
        let makeTask: (String) -> PhoneDexTask = { machine in
            PhoneDexTask(
                id: "task-\(machine)", at: "2026-07-15T12:00:00.000Z", source: "codex",
                title: "Completed task", text: "Done", cwd: nil, workspaceName: "PhoneDex",
                machineName: machine, sessionId: nil, status: "completed", branch: nil, repository: nil
            )
        }
        let newest = makeTask("Mac")
        let archived = makeTask("Archived")
        let muted = makeTask("Muted")
        let read = makeTask("Read")
        let markedReadAt = Date(timeIntervalSince1970: 1_800_000_100)

        let count = PhoneDexNotificationBadgePolicy.unreadCount(
            tasks: [newest, archived, muted, read],
            readAt: [read.id: markedReadAt],
            archivedIDs: [archived.id],
            mutedIDs: [muted.id]
        )

        XCTAssertEqual(count, 1)
    }

    func testNotificationBadgeClampsNegativeAndLargeCounts() {
        XCTAssertEqual(PhoneDexNotificationBadgePolicy.displayCount(-1), 0)
        XCTAssertEqual(
            PhoneDexNotificationBadgePolicy.displayCount(PhoneDexNotificationBadgePolicy.maximumDisplayCount + 1),
            PhoneDexNotificationBadgePolicy.maximumDisplayCount
        )
    }

    func testLegacyUserDefaultsTokenMigratesToSecureStoreAndIsRemoved() throws {
        let defaults = try makeDefaults()
        defaults.set("legacy-secret", forKey: "phonedex.token")
        let store = InMemoryTokenStore()

        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)

        XCTAssertEqual(settings.token, "legacy-secret")
        XCTAssertEqual(store.token, "legacy-secret")
        XCTAssertNil(defaults.string(forKey: "phonedex.token"))
        XCTAssertNil(settings.credentialStorageError)
    }

    func testTokenEditsPersistToSecureStoreAndClearingRemovesIt() throws {
        let defaults = try makeDefaults()
        let store = InMemoryTokenStore()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)

        settings.token = "new-secret"
        XCTAssertEqual(store.token, "new-secret")

        settings.token = "   "
        XCTAssertNil(store.token)
        XCTAssertNil(settings.credentialStorageError)
    }

    func testForgetCredentialRemovesKeychainValueBeforeClearingPublishedToken() throws {
        let defaults = try makeDefaults()
        let store = InMemoryTokenStore()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)
        settings.token = "paired-secret"

        XCTAssertTrue(settings.forgetCredential())
        XCTAssertTrue(settings.token.isEmpty)
        XCTAssertNil(store.token)
        XCTAssertNil(settings.credentialStorageError)
    }

    func testModelForgetCredentialClearsPendingRepliesButPreservesLocalReviewState() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())
        settings.token = "paired-secret"
        let pending = PhoneDexPendingReply(
            commandId: "command-1",
            idempotencyKey: "key-1",
            taskId: "task-1",
            choice: "custom",
            prompt: "Continue",
            expectedTaskVersion: 3,
            sessionId: "session-1",
            machineName: "Mac",
            createdAt: Date(timeIntervalSince1970: 1_750_000_000)
        )
        let task = PhoneDexTask(
            id: "task-1", at: nil, source: "codex", title: "Completed task",
            text: "Review me", cwd: "/work/project", workspaceName: "PhoneDex",
            machineName: "Mac", sessionId: "session-1", status: "completed",
            branch: "main", repository: "phonedex"
        )
        let cache = TestCache(state: PhoneDexCachedState(
            cursor: "cursor-1", tasks: [task], devices: [],
            lastSyncAt: Date(timeIntervalSince1970: 1_750_000_001),
            pendingReplies: [pending]
        ))
        let model = PhoneDexAppModel(settings: settings, cache: cache)

        XCTAssertTrue(model.forgetCredential())
        XCTAssertTrue(model.pendingReplies.isEmpty)
        XCTAssertTrue(model.tasks.contains(task))
        XCTAssertEqual(cache.state?.cursor, "cursor-1")
        XCTAssertTrue(cache.state?.pendingReplies.isEmpty == true)
    }

    func testModelRestorePersistsExpiredArtifactPruning() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())
        let now = Date()
        let expired = PhoneDexCachedArtifact(
            id: "expired",
            name: "old.log",
            mediaType: "text/plain",
            data: Data("expired private bytes".utf8),
            downloadedAt: now.addingTimeInterval(-PhoneDexCachedArtifactPolicy.retention - 1)
        )
        let recent = PhoneDexCachedArtifact(
            id: "recent",
            name: "current.log",
            mediaType: "text/plain",
            data: Data("recent private bytes".utf8),
            downloadedAt: now
        )
        let cache = TestCache(state: PhoneDexCachedState(
            cursor: "cursor",
            tasks: [],
            devices: [],
            lastSyncAt: now,
            cachedArtifacts: [expired, recent]
        ))

        let model = PhoneDexAppModel(settings: settings, cache: cache)

        XCTAssertNil(model.cachedArtifacts[expired.id])
        XCTAssertEqual(model.cachedArtifacts[recent.id], recent)
        XCTAssertEqual(cache.state?.cachedArtifacts, [recent])
    }

    func testModelForgetCredentialFailurePreservesPendingReplies() throws {
        let defaults = try makeDefaults()
        let store = InMemoryTokenStore()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)
        settings.token = "paired-secret"
        let pending = PhoneDexPendingReply(
            commandId: "command-1", idempotencyKey: "key-1", taskId: "task-1",
            choice: "custom", prompt: "Continue", expectedTaskVersion: 3,
            sessionId: nil, machineName: nil, createdAt: Date()
        )
        let cache = TestCache(state: PhoneDexCachedState(
            cursor: nil, tasks: [], devices: [], lastSyncAt: nil,
            pendingReplies: [pending]
        ))
        let model = PhoneDexAppModel(settings: settings, cache: cache)
        store.shouldFail = true

        XCTAssertFalse(model.forgetCredential())
        XCTAssertEqual(model.pendingReplies, [pending])
        XCTAssertEqual(store.token, "paired-secret")
    }

    func testModelClearLocalCacheRemovesPrivateProjectionButKeepsCredential() throws {
        let defaults = try makeDefaults()
        let store = InMemoryTokenStore()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)
        settings.token = "paired-secret"
        let task = PhoneDexTask(
            id: "task-1", at: nil, source: "codex", title: "Private task",
            text: "Private transcript", cwd: "/work/project", workspaceName: "PhoneDex",
            machineName: "Mac", sessionId: "session-1", status: "completed",
            branch: "main", repository: "phonedex"
        )
        let cache = TestCache(state: PhoneDexCachedState(
            cursor: "cursor-1", tasks: [task], devices: [],
            lastSyncAt: Date(), drafts: [task.id: "private draft"],
            cachedArtifacts: [PhoneDexCachedArtifact(
                id: "artifact-1", name: "private.log", mediaType: "text/plain",
                data: Data("private bytes".utf8), downloadedAt: Date()
            )]
        ))
        let model = PhoneDexAppModel(settings: settings, cache: cache)

        XCTAssertTrue(model.clearLocalCache())
        XCTAssertTrue(model.tasks.isEmpty)
        XCTAssertTrue(model.drafts.isEmpty)
        XCTAssertTrue(model.cachedArtifacts.isEmpty)
        XCTAssertNil(cache.state?.cursor)
        XCTAssertTrue(cache.state?.tasks.isEmpty == true)
        XCTAssertEqual(store.token, "paired-secret")
        XCTAssertTrue(model.localCacheStatusMessage?.contains("credential was kept") == true)
    }

    func testModelClearLocalCacheFailurePreservesTrustedProjection() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())
        let task = PhoneDexTask(
            id: "task-1", at: nil, source: "codex", title: "Trusted task",
            text: "Cached response", cwd: nil, workspaceName: nil,
            machineName: nil, sessionId: nil, status: "completed",
            branch: nil, repository: nil
        )
        let cache = TestCache(state: PhoneDexCachedState(
            cursor: "cursor-1", tasks: [task], devices: [], lastSyncAt: Date()
        ))
        let model = PhoneDexAppModel(settings: settings, cache: cache)
        cache.shouldFail = true

        XCTAssertFalse(model.clearLocalCache())
        XCTAssertEqual(model.tasks, [task])
        XCTAssertEqual(cache.state?.cursor, "cursor-1")
        XCTAssertEqual(model.localCacheStatusMessage, "Local data could not be cleared. Try again.")
    }

    func testForgetCredentialFailurePreservesTokenAndDoesNotLeakSecret() throws {
        let defaults = try makeDefaults()
        let store = InMemoryTokenStore()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)
        settings.token = "paired-secret"
        store.shouldFail = true

        XCTAssertFalse(settings.forgetCredential())
        XCTAssertEqual(settings.token, "paired-secret")
        XCTAssertEqual(store.token, "paired-secret")
        XCTAssertEqual(settings.credentialStorageError, "Secure credential storage is unavailable. Try again.")
        XCTAssertFalse(settings.credentialStorageError?.contains("paired-secret") == true)
    }

    func testApprovalAuthenticationIsEnabledByDefaultAndCanBeDisabled() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())

        XCTAssertTrue(settings.requireApprovalAuthentication)

        settings.requireApprovalAuthentication = false

        XCTAssertFalse(settings.requireApprovalAuthentication)
        XCTAssertEqual(defaults.bool(forKey: "phonedex.requireApprovalAuthentication"), false)
    }

    func testSecureStorageFailureIsExposedWithoutLeakingTheCredential() throws {
        let defaults = try makeDefaults()
        let store = InMemoryTokenStore()
        store.shouldFail = true
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)

        settings.token = "secret-that-must-not-appear"

        XCTAssertEqual(
            settings.credentialStorageError,
            "Secure credential storage is unavailable. Try again."
        )
        XCTAssertFalse(settings.credentialStorageError?.contains("secret") == true)
    }

    func testKeychainTokenStoreRoundTripsAndRemovesDeviceOnlyCredential() throws {
        let service = "com.nash226.PhoneDex.tests.\(UUID().uuidString)"
        let store = PhoneDexKeychainTokenStore(service: service, account: "bridge-token")
        defer { try? store.removeToken() }

        do {
            try store.writeToken("keychain-secret")
        } catch PhoneDexKeychainError.keychain(let status) where status == errSecMissingEntitlement {
            throw XCTSkip("Unsigned simulator tests cannot access the iOS Keychain.")
        }
        XCTAssertEqual(try store.readToken(), "keychain-secret")

        try store.removeToken()
        XCTAssertNil(try store.readToken())
    }

    func testNativeBridgeURLRejectsEmbeddedCredentialsAndQueries() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())

        settings.bridgeURL = "https://user:password@bridge.test"
        XCTAssertNil(settings.normalizedBridgeURL)

        settings.bridgeURL = "https://bridge.test?token=secret"
        XCTAssertNil(settings.normalizedBridgeURL)
    }

    func testConfigurationURLDoesNotImportTokenFromURL() throws {
        let defaults = try makeDefaults()
        let store = InMemoryTokenStore()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: store)
        let url = try XCTUnwrap(URL(string: "phonedex://configure?bridgeUrl=https%3A%2F%2Fbridge.test&token=secret"))

        XCTAssertTrue(settings.apply(configurationURL: url))
        XCTAssertEqual(settings.normalizedBridgeURL?.absoluteString, "https://bridge.test")
        XCTAssertTrue(settings.token.isEmpty)
        XCTAssertNil(store.token)
    }

    func testTaskNotificationMetadataContainsNoCredential() throws {
        let task = PhoneDexTask(
            id: "task_123",
            at: "2026-07-15T12:00:00.000Z",
            source: "codex",
            title: "Completed task",
            text: "Done",
            cwd: "/work/project",
            workspaceName: nil,
            machineName: "Studio Mac",
            sessionId: "thread_456",
            status: "completed",
            branch: nil,
            repository: nil
        )

        let metadata = PhoneDexNotificationScheduler.taskNotificationUserInfo(task)

        XCTAssertNil(metadata["token"])
        XCTAssertNil(metadata["replyUrl"])
        XCTAssertNil(metadata["bridgeUrl"])
        XCTAssertFalse(metadata.values.contains { String(describing: $0).contains("secret") })
    }

    func testNotificationThreadGroupsByBoundedWorkspaceAndMachineIdentity() {
        let task = PhoneDexTask(
            id: "task-1",
            at: nil,
            source: "stop-hook",
            title: "Review",
            text: "Done",
            cwd: "/Users/example/PhoneDex",
            workspaceName: "PhoneDex / Secrets",
            machineName: "MacBook Pro #1",
            sessionId: "session-1",
            status: "completed",
            branch: nil,
            repository: nil
        )

        XCTAssertEqual(
            PhoneDexNotificationScheduler.taskNotificationThreadIdentifier(task),
            "phonedex.PhoneDexSecrets.MacBookPro1"
        )
    }

    func testNotificationThreadSeparatesSameWorkspaceOnDifferentMachines() {
        let makeTask: (String) -> PhoneDexTask = { machine in
            PhoneDexTask(
                id: "task-\(machine)",
                at: nil,
                source: "stop-hook",
                title: "Review",
                text: "Done",
                cwd: nil,
                workspaceName: "PhoneDex",
                machineName: machine,
                sessionId: nil,
                status: "completed",
                branch: nil,
                repository: nil
            )
        }

        XCTAssertNotEqual(
            PhoneDexNotificationScheduler.taskNotificationThreadIdentifier(makeTask("MacBook")),
            PhoneDexNotificationScheduler.taskNotificationThreadIdentifier(makeTask("Windows"))
        )
    }

    func testNotificationCopyHasStableEnglishFallbacks() {
        XCTAssertEqual(PhoneDexNotificationCopy.previewTitle, "Codex done: PR update")
        XCTAssertEqual(PhoneDexNotificationCopy.previewSubtitle, "PhoneDex • MacBook Air")
        XCTAssertEqual(PhoneDexNotificationCopy.okayWhatsNext, "Okay, what's next")
        XCTAssertEqual(PhoneDexNotificationCopy.letsDoThat, "Let's do that")
        XCTAssertEqual(PhoneDexNotificationCopy.customReply, "Custom reply")
        XCTAssertEqual(PhoneDexNotificationCopy.sendReply, "Send")
        XCTAssertEqual(PhoneDexNotificationCopy.replyPlaceholder, "Dictate or type your reply")
        XCTAssertEqual(
            PhoneDexNotificationError.credentialBearingBridgeURL.errorDescription,
            "The bridge URL must not contain credentials or query parameters."
        )
    }

    func testNotificationPrivacyDefaultsToSafeSummaryAndPersistsOptIn() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())

        XCTAssertEqual(settings.notificationPrivacy, .safeSummary)
        settings.notificationPrivacy = .fullPreview

        let restored = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())
        XCTAssertEqual(restored.notificationPrivacy, .fullPreview)
        XCTAssertEqual(defaults.string(forKey: "phonedex.notificationPrivacy"), "fullPreview")
    }

    func testWorkspaceNotificationPolicyPersistsAndIgnoresEmptyNames() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())

        settings.setNotificationMuted(true, for: " Project ")
        settings.setNotificationMuted(true, for: "   ")

        let restored = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())
        XCTAssertEqual(restored.mutedNotificationWorkspaces, ["Project"])
        XCTAssertTrue(restored.isNotificationMuted(for: "Project"))
        restored.setNotificationMuted(false, for: "Project")
        XCTAssertTrue(restored.mutedNotificationWorkspaces.isEmpty)
    }

    func testNotificationPolicySuppressesOnlyMutedWorkspace() {
        let task = PhoneDexTask(
            id: "task-policy",
            at: nil,
            source: "bridge",
            title: "Private title",
            text: "Private task text",
            cwd: "/private/path",
            workspaceName: "Project",
            machineName: "Mac",
            sessionId: "session",
            status: "completed",
            branch: nil,
            repository: nil,
            deviceId: "device"
        )

        XCTAssertEqual(
            PhoneDexNotificationScheduler.notificationPolicyDecision(for: task, mutedWorkspaces: ["Project"]),
            .suppressed(workspace: "Project")
        )
        XCTAssertEqual(
            PhoneDexNotificationScheduler.notificationPolicyDecision(for: task, mutedWorkspaces: []),
            .allowed
        )
    }

    func testNotificationAuthorizationCopyExplainsDeniedRecovery() {
        let denied = PhoneDexNotificationAuthorization.denied

        XCTAssertEqual(denied.title, "Notifications are disabled")
        XCTAssertTrue(denied.explanation.contains("Open iPhone Settings"))
        XCTAssertTrue(denied.canOpenSettings)
        XCTAssertFalse(denied.isEnabled)
    }

    func testNotificationAuthorizationCopyDistinguishesQuietAndFullDelivery() {
        XCTAssertTrue(PhoneDexNotificationAuthorization.authorized.isEnabled)
        XCTAssertTrue(PhoneDexNotificationAuthorization.provisional.isEnabled)
        XCTAssertFalse(PhoneDexNotificationAuthorization.notDetermined.canOpenSettings)
        XCTAssertTrue(PhoneDexNotificationAuthorization.restricted.canOpenSettings)
    }

    func testNotificationAuthorizationRecoveryStatesHaveExplicitSettingsBoundary() {
        XCTAssertTrue(PhoneDexNotificationAuthorization.denied.canOpenSettings)
        XCTAssertTrue(PhoneDexNotificationAuthorization.restricted.canOpenSettings)
        XCTAssertFalse(PhoneDexNotificationAuthorization.unknown.canOpenSettings)
        XCTAssertTrue(PhoneDexNotificationAuthorization.denied.explanation.contains("still refreshes"))
    }

    func testSafeNotificationSummaryExcludesTaskContent() {
        let task = PhoneDexTask(
            id: "task-privacy", at: nil, source: "stop-hook", title: "Private prompt",
            text: "Secret source path and prompt", cwd: "/private/repo",
            workspaceName: "PhoneDex", machineName: "Mac", sessionId: nil,
            status: "completed", branch: nil, repository: nil
        )

        let presentation = PhoneDexNotificationScheduler.notificationPresentation(
            for: task,
            privacy: .safeSummary
        )

        XCTAssertFalse(presentation.title.contains("Private"))
        XCTAssertFalse(presentation.body.contains("Secret"))
        XCTAssertFalse(presentation.body.contains("/private/repo"))
        XCTAssertEqual(presentation.body, PhoneDexNotificationCopy.safeSummaryBody)
    }

    func testFullNotificationPreviewIsExplicitlyOptIn() {
        let task = PhoneDexTask(
            id: "task-preview", at: nil, source: "stop-hook", title: "Private prompt",
            text: "Secret result", cwd: nil, workspaceName: "PhoneDex",
            machineName: "Mac", sessionId: nil, status: "completed", branch: nil,
            repository: nil
        )

        let presentation = PhoneDexNotificationScheduler.notificationPresentation(
            for: task,
            privacy: .fullPreview
        )

        XCTAssertEqual(presentation.title, "Private prompt")
        XCTAssertEqual(presentation.body, "Secret result")
    }

    func testFullNotificationPreviewIsBounded() {
        let task = PhoneDexTask(
            id: "task-long-preview", at: nil, source: "stop-hook", title: String(repeating: "T", count: 200),
            text: String(repeating: "R", count: 600), cwd: nil, workspaceName: "PhoneDex",
            machineName: "Mac", sessionId: nil, status: "completed", branch: nil, repository: nil
        )

        let presentation = PhoneDexNotificationScheduler.notificationPresentation(
            for: task,
            privacy: .fullPreview
        )

        XCTAssertEqual(presentation.title.count, 120)
        XCTAssertEqual(presentation.body.count, 500)
        XCTAssertTrue(presentation.title.hasSuffix("…"))
        XCTAssertTrue(presentation.body.hasSuffix("…"))
    }

    func testBridgePolicyRequiresHTTPSOutsideLoopback() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())

        settings.bridgeURL = "http://192.168.1.20:8765"

        XCTAssertNil(settings.normalizedBridgeURL)
        XCTAssertEqual(
            settings.bridgeURLValidationMessage,
            "Use an HTTPS bridge URL. HTTP is available only for localhost development."
        )

        settings.bridgeURL = "https://macbook.example.test:8765"

        XCTAssertEqual(settings.normalizedBridgeURL?.absoluteString, "https://macbook.example.test:8765")
        XCTAssertTrue(settings.bridgeURLValidationMessage.isEmpty)
    }

    func testLoopbackHTTPRemainsAvailableForLocalDevelopment() throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())

        settings.bridgeURL = "http://127.0.0.1:8765/"

        XCTAssertEqual(settings.normalizedBridgeURL?.absoluteString, "http://127.0.0.1:8765")
        XCTAssertTrue(settings.bridgeURLValidationMessage.isEmpty)
    }

    private func makeDefaults() throws -> UserDefaults {
        let suiteName = "PhoneDexSettingsTests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            throw NSError(domain: "PhoneDexSettingsTests", code: 1)
        }
        addTeardownBlock { defaults.removePersistentDomain(forName: suiteName) }
        return defaults
    }
}

private final class InMemoryTokenStore: PhoneDexTokenStoring {
    var token: String?
    var shouldFail = false

    func readToken() throws -> String? {
        try checkFailure()
        return token
    }

    func writeToken(_ token: String) throws {
        try checkFailure()
        self.token = token
    }

    func removeToken() throws {
        try checkFailure()
        token = nil
    }

    private func checkFailure() throws {
        if shouldFail {
            throw PhoneDexKeychainError.keychain(-1)
        }
    }
}

private final class TestCache: PhoneDexCacheStoring {
    var state: PhoneDexCachedState?
    var shouldFail = false

    init(state: PhoneDexCachedState?) {
        self.state = state
    }

    func load() throws -> PhoneDexCachedState? { state }

    func save(_ state: PhoneDexCachedState) throws {
        if shouldFail { throw PhoneDexCacheError.persistenceFailed }
        self.state = state
    }

    func remove() throws {
        state = nil
    }
}
