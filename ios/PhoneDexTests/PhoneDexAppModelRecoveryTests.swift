import XCTest
@testable import PhoneDex

@MainActor
final class PhoneDexAppModelRecoveryTests: XCTestCase {
    func testCorruptCacheQuarantineLeavesFreshSyncProjectionRecoverable() {
        let cache = FailingRecoveryCache()
        let suiteName = "PhoneDexAppModelRecoveryTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suiteName) }
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: RecoveryTokenStore())

        let model = PhoneDexAppModel(settings: settings, cache: cache)

        XCTAssertTrue(model.tasks.isEmpty)
        XCTAssertTrue(model.devices.isEmpty)
        XCTAssertTrue(model.events.isEmpty)
        XCTAssertNil(model.selectedTaskID)
        XCTAssertEqual(model.connectionState, .idle)
        XCTAssertEqual(
            model.cacheRecoveryMessage,
            "PhoneDex could not restore its local cache. Fresh data will be fetched when the hub is reachable."
        )
        XCTAssertEqual(cache.quarantineCalls, 1)
        XCTAssertEqual(cache.saveCalls, 0)
    }
}

private final class FailingRecoveryCache: PhoneDexCacheStoring {
    private(set) var quarantineCalls = 0
    private(set) var saveCalls = 0

    func load() throws -> PhoneDexCachedState? {
        throw PhoneDexCacheError.invalidData
    }

    func save(_ state: PhoneDexCachedState) throws {
        saveCalls += 1
    }

    func remove() throws {}

    func quarantine() throws {
        quarantineCalls += 1
    }
}

private final class RecoveryTokenStore: PhoneDexTokenStoring {
    func readToken() throws -> String? { nil }
    func writeToken(_ token: String) throws {}
    func removeToken() throws {}
}
