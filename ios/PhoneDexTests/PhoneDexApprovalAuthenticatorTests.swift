import XCTest
@testable import PhoneDex

@MainActor
final class PhoneDexApprovalAuthenticatorTests: XCTestCase {
    func testAuthenticationFailureIsPrivacySafe() async {
        let error = PhoneDexApprovalAuthenticationError.cancelled

        XCTAssertEqual(error.localizedDescription, "Approval confirmation was cancelled.")
        XCTAssertFalse(error.localizedDescription.contains("approval_"))
        XCTAssertFalse(error.localizedDescription.contains("task_"))
    }

    func testModelStopsBeforeCommandWhenApprovalAuthenticationFails() async throws {
        let defaults = try makeDefaults()
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: InMemoryTokenStore())
        let authenticator = StubApprovalAuthenticator(result: .failure(.cancelled))
        let model = PhoneDexAppModel(
            settings: settings,
            cache: InMemoryCache(),
            approvalAuthenticator: authenticator,
            bridgeClient: PhoneDexBridgeClient(
                bridgeURL: URL(string: "https://bridge.test")!,
                token: "credential"
            )
        )
        let task = try decodeTask()

        let didRespond = await model.respondToApproval(.approve, for: task)
        let lifecycleState = model.lifecycleState

        XCTAssertFalse(didRespond)
        XCTAssertEqual(lifecycleState, .failed("Approval confirmation was cancelled."))
        XCTAssertEqual(authenticator.attempts, 1)
    }

    private func decodeTask() throws -> PhoneDexTask {
        let data = Data("""
        {
          "id": "task_approval",
          "at": "2026-07-15T12:00:00.000Z",
          "source": "agent",
          "title": "Approval task",
          "text": "Review the operation.",
          "cwd": "/workspace",
          "machineName": "Studio Mac",
          "sessionId": "session_approval",
          "status": "awaiting_approval",
          "version": 4,
          "approvalRequest": {
            "id": "approval_1",
            "taskVersion": 4,
            "operation": "Run tests",
            "scope": "workspace",
            "origin": {
              "deviceId": "mac_1",
              "machineName": "Studio Mac"
            },
            "reason": "The task needs validation.",
            "risk": "low",
            "requestedAt": "2026-07-15T12:00:00.000Z",
            "expiresAt": "2099-07-15T12:15:00.000Z",
            "state": "pending"
          },
          "lifecycleCapabilities": ["approval.respond.v1"]
        }
        """.utf8)
        return try JSONDecoder().decode(PhoneDexTask.self, from: data)
    }

    private func makeDefaults() throws -> UserDefaults {
        let suiteName = "PhoneDexApprovalAuthenticatorTests.\(UUID().uuidString)"
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            throw NSError(domain: "PhoneDexApprovalAuthenticatorTests", code: 1)
        }
        addTeardownBlock { defaults.removePersistentDomain(forName: suiteName) }
        return defaults
    }
}

private final class StubApprovalAuthenticator: PhoneDexApprovalAuthenticating {
    enum Result {
        case success
        case failure(PhoneDexApprovalAuthenticationError)
    }

    private(set) var attempts = 0
    let result: Result

    init(result: Result) {
        self.result = result
    }

    func authenticate() async throws {
        attempts += 1
        if case .failure(let error) = result {
            throw error
        }
    }
}

private final class InMemoryCache: PhoneDexCacheStoring {
    func load() throws -> PhoneDexCachedState? { nil }
    func save(_ state: PhoneDexCachedState) throws {}
    func remove() throws {}
}

private final class InMemoryTokenStore: PhoneDexTokenStoring {
    func readToken() throws -> String? { nil }
    func writeToken(_ token: String) throws {}
    func removeToken() throws {}
}
