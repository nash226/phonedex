import XCTest
import Security
@testable import PhoneDex

@MainActor
final class PhoneDexSettingsTests: XCTestCase {
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

        let metadata = PhoneDexNotificationScheduler.taskNotificationUserInfo(
            task,
            bridgeURL: try XCTUnwrap(URL(string: "https://bridge.test"))
        )

        XCTAssertNil(metadata["token"])
        XCTAssertFalse(metadata.values.contains { String(describing: $0).contains("secret") })
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
