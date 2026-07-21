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

    func testCompleteHubSyncClearsRecoveredCacheWarning() async {
        let cache = FailingRecoveryCache()
        let suiteName = "PhoneDexAppModelRecoveryTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suiteName) }
        let settings = PhoneDexSettings(defaults: defaults, tokenStore: RecoveryTokenStore())
        settings.bridgeURL = "http://bridge.test"

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RecoveryURLProtocol.self]
        let client = PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "paired-secret",
            session: URLSession(configuration: configuration)
        )
        RecoveryURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/sync")
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"schema":"phonedex.sync.v1","protocolVersion":1,"revision":1,"position":1,"snapshot":{"complete":true,"revision":1,"position":1,"tasks":[],"devices":[]},"changes":[],"cursor":"cursor.done","hasMore":false,"updatedAt":"2026-07-21T12:00:00.000Z"}
                """.utf8)
            )
        }
        addTeardownBlock { RecoveryURLProtocol.handler = nil }

        let model = PhoneDexAppModel(settings: settings, cache: cache, bridgeClient: client)
        XCTAssertNotNil(model.cacheRecoveryMessage)

        await model.refresh()

        XCTAssertNil(model.cacheRecoveryMessage)
        XCTAssertEqual(model.connectionState, .online(model.lastSuccessfulSync!))
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

private final class RecoveryURLProtocol: URLProtocol {
    typealias Handler = (URLRequest) throws -> (HTTPURLResponse, Data)
    static var handler: Handler?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        do {
            let (response, data) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
