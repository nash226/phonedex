import XCTest
@testable import PhoneDex

final class PhoneDexBridgeClientTests: XCTestCase {
    override func tearDown() {
        URLProtocolStub.handler = nil
        super.tearDown()
    }

    func testSendReplyUsesAuthenticatedJSONContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/reply")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer secret")
            XCTAssertEqual(request.value(forHTTPHeaderField: "content-type"), "application/json")

            let body = try request.httpBody ?? XCTUnwrap(request.httpBodyStream).readAllData()
            let json = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: String]
            )
            XCTAssertEqual(json["taskId"], "task_123")
            XCTAssertEqual(json["sessionId"], "thread_456")
            XCTAssertEqual(json["choice"], "custom")
            XCTAssertEqual(json["prompt"], "Run the focused tests")
            XCTAssertEqual(json["reply_text"], "Run the focused tests")
            XCTAssertEqual(json["machineName"], "Studio Mac")

            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("{\"ok\":true}".utf8)
            )
        }

        let client = PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        )

        try await client.sendReply(
            choice: .custom,
            prompt: "Run the focused tests",
            taskId: "task_123",
            sessionId: "thread_456",
            machineName: "Studio Mac"
        )
    }

    func testFetchTasksRequestsCompleteProjectHistory() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/tasks?limit=all")
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer secret")

            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("[]".utf8)
            )
        }

        let client = PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        )

        let tasks = try await client.fetchTasks()
        XCTAssertTrue(tasks.isEmpty)
    }

    func testFetchSyncReadsPaginatedSnapshotWithBearerAuth() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        var requestCount = 0

        URLProtocolStub.handler = { request in
            requestCount += 1
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer secret")
            XCTAssertEqual(request.value(forHTTPHeaderField: "x-phonedex-protocol-version"), "1")
            XCTAssertEqual(
                request.value(forHTTPHeaderField: "x-phonedex-capabilities"),
                "sync.snapshot.v1,device.health.v1"
            )
            if requestCount == 1 {
                XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/sync?limit=1")
                return (
                    HTTPURLResponse(
                        url: try XCTUnwrap(request.url),
                        statusCode: 200,
                        httpVersion: nil,
                        headerFields: ["content-type": "application/json"]
                    )!,
                    Data("""
                    {"schema":"phonedex.sync.v1","protocolVersion":1,"revision":1,"position":1,"snapshot":{"complete":false,"revision":1,"position":1,"tasks":[{"id":"task_123","title":"Build passed","text":"All good","cwd":"/tmp/PhoneDex","machineName":"Studio Mac","status":"completed"}],"devices":[]},"changes":[],"cursor":"v1.next","hasMore":true,"updatedAt":"2026-07-15T12:00:00.000Z"}
                    """.utf8)
                )
            }

            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/sync?limit=1&cursor=v1.next")
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"schema":"phonedex.sync.v1","protocolVersion":1,"revision":1,"position":1,"snapshot":{"complete":true,"revision":1,"position":1,"tasks":[],"devices":[]},"changes":[],"cursor":"v1.done","hasMore":false,"updatedAt":"2026-07-15T12:00:00.000Z"}
                """.utf8)
            )
        }

        let client = PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        )

        let result = try await client.fetchSync(limit: 1)
        XCTAssertEqual(requestCount, 2)
        XCTAssertEqual(result.tasks.map(\.id), ["task_123"])
        XCTAssertTrue(result.devices.isEmpty)
    }

    func testIncrementalSyncAppliesReplacementAndTombstone() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/sync?limit=50&cursor=cursor.old")
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"snapshot":null,"changes":[
                  {"position":8,"kind":"task","id":"task_123","deleted":false,"record":{"id":"task_123","title":"Updated","text":"New result"}},
                  {"position":9,"kind":"device","id":"device_old","deleted":true}
                ],"cursor":"cursor.new","hasMore":false}
                """.utf8)
            )
        }

        let oldTask = PhoneDexTask(
            id: "task_123",
            at: nil,
            source: nil,
            title: "Old",
            text: "Old result",
            cwd: nil,
            workspaceName: nil,
            machineName: nil,
            sessionId: nil,
            status: nil,
            branch: nil,
            repository: nil
        )
        let oldDevice = PhoneDexDevice(
            deviceId: "device_old",
            machineName: "Old Mac",
            platform: "macos",
            role: "agent",
            status: "online",
            lastSeenAt: nil,
            version: nil,
            publicUrl: nil,
            expected: nil
        )

        let result = try await PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        ).fetchSyncState(
            cursor: "cursor.old",
            tasks: [oldTask],
            devices: [oldDevice]
        )

        XCTAssertEqual(result.tasks?.first?.title, "Updated")
        XCTAssertTrue(result.devices?.isEmpty == true)
        XCTAssertEqual(result.cursor, "cursor.new")
    }

    func testStaleCursorRestartsFromFreshSnapshot() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        var requestURLs: [String] = []

        URLProtocolStub.handler = { request in
            requestURLs.append(request.url?.absoluteString ?? "")
            if requestURLs.count == 1 {
                return (
                    HTTPURLResponse(
                        url: try XCTUnwrap(request.url),
                        statusCode: 409,
                        httpVersion: nil,
                        headerFields: nil
                    )!,
                    Data("{\"code\":\"sync_snapshot_changed\"}".utf8)
                )
            }
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"snapshot":{"complete":true,"tasks":[{"id":"fresh","title":"Fresh","text":"State"}],"devices":[]},"changes":[],"cursor":"cursor.fresh","hasMore":false}
                """.utf8)
            )
        }

        let result = try await PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        ).fetchSyncState(cursor: "cursor.stale", tasks: [PhoneDexTask(
            id: "old",
            at: nil,
            source: nil,
            title: "Old",
            text: "Old",
            cwd: nil,
            workspaceName: nil,
            machineName: nil,
            sessionId: nil,
            status: nil,
            branch: nil,
            repository: nil
        )])

        XCTAssertEqual(requestURLs, [
            "http://bridge.test/sync?limit=50&cursor=cursor.stale",
            "http://bridge.test/sync?limit=50"
        ])
        XCTAssertEqual(result.tasks?.map(\.id), ["fresh"])
        XCTAssertTrue(result.restartedFromSnapshot)
    }

    func testProtocolIncompatibilityIsReportedWithoutLegacyFallback() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 426,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data("{\"code\":\"protocol_incompatible\",\"error\":\"Update the hub.\"}".utf8)
            )
        }

        let client = PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        )

        do {
            _ = try await client.fetchSyncPage()
            XCTFail("Expected protocol incompatibility")
        } catch {
            XCTAssertTrue(error.isProtocolIncompatible)
            XCTAssertEqual(error.localizedDescription, "Update the hub.")
            XCTAssertFalse(error.isCompatibilityFailure)
        }
    }

    func testUnsupportedCapabilityIsReportedAsCompatibilityError() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 426,
                    httpVersion: nil,
                    headerFields: nil
                )!,
                Data("{\"code\":\"capability_unsupported\",\"error\":\"Update the hub.\"}".utf8)
            )
        }

        do {
            _ = try await PhoneDexBridgeClient(
                bridgeURL: URL(string: "http://bridge.test")!,
                token: "secret",
                session: session
            ).fetchSyncPage()
            XCTFail("Expected unsupported capability")
        } catch {
            XCTAssertTrue(error.isProtocolIncompatible)
            XCTAssertEqual(error.localizedDescription, "Update the hub.")
        }
    }

    func testResilientSyncFallsBackWithoutHidingPartialData() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        var requestedPaths: [String] = []

        URLProtocolStub.handler = { request in
            requestedPaths.append(request.url?.path ?? "")
            switch request.url?.path {
            case "/sync":
                return (
                    HTTPURLResponse(
                        url: try XCTUnwrap(request.url),
                        statusCode: 404,
                        httpVersion: nil,
                        headerFields: ["content-type": "application/json"]
                    )!,
                    Data("{\"error\":\"Not found\"}".utf8)
                )
            case "/tasks":
                return (
                    HTTPURLResponse(
                        url: try XCTUnwrap(request.url),
                        statusCode: 200,
                        httpVersion: nil,
                        headerFields: ["content-type": "application/json"]
                    )!,
                    Data("[{\"id\":\"task_123\",\"title\":\"Build passed\",\"text\":\"All good\"}]".utf8)
                )
            case "/devices":
                return (
                    HTTPURLResponse(
                        url: try XCTUnwrap(request.url),
                        statusCode: 503,
                        httpVersion: nil,
                        headerFields: ["content-type": "application/json"]
                    )!,
                    Data("{\"error\":\"Unavailable\"}".utf8)
                )
            default:
                throw URLError(.badURL)
            }
        }

        let client = PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        )

        let result = try await client.fetchResilientSync(limit: 1)

        XCTAssertEqual(requestedPaths.sorted(), ["/devices", "/sync", "/tasks"])
        XCTAssertEqual(result.tasks?.map(\.id), ["task_123"])
        XCTAssertNil(result.devices)
        XCTAssertTrue(result.usedCompatibilityFallback)
        XCTAssertEqual(result.availableDataSet, .tasks)
    }

    func testBridgeErrorsClassifyRevokedAndCompatibilityResponses() {
        XCTAssertTrue(PhoneDexBridgeClientError.httpStatus(401, "").isRevoked)
        XCTAssertTrue(PhoneDexBridgeClientError.httpStatus(404, "").isCompatibilityFailure)
        XCTAssertFalse(PhoneDexBridgeClientError.httpStatus(500, "").isCompatibilityFailure)
        XCTAssertTrue(URLError(.notConnectedToInternet).isOffline)
    }
}

private extension InputStream {
    func readAllData() throws -> Data {
        open()
        defer { close() }

        var result = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while hasBytesAvailable {
            let count = read(&buffer, maxLength: buffer.count)
            if count < 0 {
                throw streamError ?? URLError(.cannotDecodeContentData)
            }
            if count == 0 { break }
            result.append(contentsOf: buffer[0..<count])
        }
        return result
    }
}

private final class URLProtocolStub: URLProtocol {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            XCTFail("URLProtocolStub handler was not configured")
            return
        }

        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}
