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
