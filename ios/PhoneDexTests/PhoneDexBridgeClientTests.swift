import XCTest
import CryptoKit
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
            XCTAssertEqual(request.timeoutInterval, PhoneDexBridgeClient.requestTimeout)
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer secret")
            XCTAssertEqual(request.value(forHTTPHeaderField: "content-type"), "application/json")

            let body = try request.httpBody ?? XCTUnwrap(request.httpBodyStream).readAllData()
            let json = try XCTUnwrap(
                JSONSerialization.jsonObject(with: body) as? [String: Any]
            )
            XCTAssertEqual(json["taskId"] as? String, "task_123")
            XCTAssertEqual(json["sessionId"] as? String, "thread_456")
            XCTAssertEqual(json["choice"] as? String, "custom")
            XCTAssertEqual(json["prompt"] as? String, "Run the focused tests")
            XCTAssertEqual(json["reply_text"] as? String, "Run the focused tests")
            XCTAssertEqual(json["machineName"] as? String, "Studio Mac")
            XCTAssertEqual(json["commandId"] as? String, "command_123")
            XCTAssertEqual(json["idempotencyKey"] as? String, "reply_123")
            XCTAssertEqual(json["expectedTaskVersion"] as? Int, 3)
            XCTAssertEqual(json["questionId"] as? String, "next-step")
            let response = try XCTUnwrap(json["response"] as? [String: Any])
            XCTAssertEqual(response["kind"] as? String, "choice")
            XCTAssertEqual(response["choiceId"] as? String, "tests")
            XCTAssertNil(json["token"])

            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"ok":true,"receipt":{"schema":"phonedex.command-receipt.v1","protocolVersion":1,"commandId":"command_123","createdAt":"2026-07-15T12:00:00.000Z","state":"completed","taskId":"task_123","taskVersion":3,"idempotencyKey":"reply_123","message":"Accepted"}}
                """.utf8)
            )
        }

        let client = PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        )

        let receipt = try await client.sendReply(
            choice: .custom,
            prompt: "Run the focused tests",
            taskId: "task_123",
            sessionId: "thread_456",
            machineName: "Studio Mac",
            commandId: "command_123",
            idempotencyKey: "reply_123",
            expectedTaskVersion: 3,
            questionId: "next-step",
            questionResponse: .choice("tests")
        )
        XCTAssertEqual(receipt.state, "completed")
        XCTAssertEqual(receipt.taskVersion, 3)
        XCTAssertTrue(receipt.isSuccessful)
    }

    func testSendLifecycleCommandUsesAuthenticatedIdempotentContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/command")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer secret")

            let body = try request.httpBody ?? XCTUnwrap(request.httpBodyStream).readAllData()
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["kind"] as? String, "cancel")
            XCTAssertEqual(json["taskId"] as? String, "task_123")
            XCTAssertEqual(json["commandId"] as? String, "cancel_123")
            XCTAssertEqual(json["idempotencyKey"] as? String, "cancel_key")
            XCTAssertEqual(json["expectedTaskVersion"] as? Int, 7)
            XCTAssertEqual(json["requestedCapability"] as? String, "task.cancel.v1")
            XCTAssertNil(json["token"])

            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"state":"accepted","task":{"id":"task_123","status":"canceling","version":8},"receipt":{"schema":"phonedex.command-receipt.v1","protocolVersion":1,"commandId":"cancel_123","createdAt":"2026-07-15T12:00:00.000Z","state":"accepted","taskId":"task_123","taskVersion":8,"idempotencyKey":"cancel_key","message":"Cancellation requested"}}
                """.utf8)
            )
        }

        let response = try await PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        ).sendLifecycleCommand(
            kind: "cancel",
            taskId: "task_123",
            commandId: "cancel_123",
            idempotencyKey: "cancel_key",
            expectedTaskVersion: 7
        )

        XCTAssertEqual(response.receipt.state, "accepted")
        XCTAssertEqual(response.task?.status, "canceling")
        XCTAssertEqual(response.task?.version, 8)
    }

    func testSendApprovalResponseUsesTaskVersionBoundContract() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/command")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer secret")

            let body = try request.httpBody ?? XCTUnwrap(request.httpBodyStream).readAllData()
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["kind"] as? String, "approve")
            XCTAssertEqual(json["taskId"] as? String, "task_approval")
            XCTAssertEqual(json["approvalId"] as? String, "approval_1")
            XCTAssertEqual(json["approvalTaskVersion"] as? Int, 4)
            XCTAssertEqual(json["expectedTaskVersion"] as? Int, 4)
            XCTAssertEqual(json["requestedCapability"] as? String, "approval.respond.v1")

            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"state":"accepted","receipt":{"schema":"phonedex.command-receipt.v1","protocolVersion":1,"commandId":"approval_command","createdAt":"2026-07-15T12:00:00.000Z","state":"accepted","taskId":"task_approval","taskVersion":5,"idempotencyKey":"approval_key","approvalId":"approval_1","approvalState":"approved","approvalExpiresAt":"2099-07-15T12:15:00.000Z","message":"Approval recorded"}}
                """.utf8)
            )
        }

        let response = try await PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        ).sendLifecycleCommand(
            kind: "approve",
            taskId: "task_approval",
            approvalId: "approval_1",
            approvalTaskVersion: 4,
            commandId: "approval_command",
            idempotencyKey: "approval_key",
            expectedTaskVersion: 4
        )

        XCTAssertEqual(response.receipt.approvalId, "approval_1")
        XCTAssertEqual(response.receipt.approvalState, "approved")
        XCTAssertEqual(response.receipt.taskVersion, 5)
    }

    func testRedeemPairingUsesOneTimeGrantWithoutCredentialInRequest() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/pair")
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertNil(request.value(forHTTPHeaderField: "authorization"))
            let body = try request.httpBody ?? XCTUnwrap(request.httpBodyStream).readAllData()
            let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
            XCTAssertEqual(json["grant"] as? String, "grant-secret")
            XCTAssertEqual(json["verificationCode"] as? String, "123456")
            XCTAssertEqual(json["platform"] as? String, "ios")
            XCTAssertNil(json["credential"])

            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 201,
                    httpVersion: nil,
                    headerFields: ["content-type": "application/json"]
                )!,
                Data("""
                {"ok":true,"credential":"device-credential","identity":{"id":"identity_1","deviceId":"phone_1","name":"iPhone","role":"phone","platform":"ios","scopes":["tasks.read","tasks.reply"],"status":"active"}}
                """.utf8)
            )
        }

        let response = try await PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "",
            session: session
        ).redeemPairing(grant: "grant-secret", verificationCode: "123456", deviceName: "iPhone")

        XCTAssertEqual(response.credential, "device-credential")
        XCTAssertEqual(response.identity.deviceId, "phone_1")
        XCTAssertEqual(response.identity.scopes, ["tasks.read", "tasks.reply"])
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

    func testIncrementalSyncKeepsLatestDuplicateCachedRecordsWithoutTrapping() async throws {
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
                {"snapshot":{"complete":true,"revision":2,"position":2,"tasks":[
                  {"id":"task_duplicate","title":"Old","text":"old"},
                  {"id":"task_duplicate","title":"Latest","text":"latest"}
                ],"devices":[
                  {"deviceId":"device_duplicate","machineName":"Old Mac"},
                  {"deviceId":"device_duplicate","machineName":"Latest Mac"}
                ],"events":[]},"changes":[],"cursor":"cursor.new","hasMore":false}
                """.utf8)
            )
        }

        let result = try await PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        ).fetchSyncState(cursor: "cursor.old")

        XCTAssertEqual(result.tasks?.count, 1)
        XCTAssertEqual(result.tasks?.first?.title, "Latest")
        XCTAssertEqual(result.devices?.count, 1)
        XCTAssertEqual(result.devices?.first?.machineName, "Latest Mac")
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

    func testDownloadArtifactUsesBearerAuthAndVerifiesDigest() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        let bytes = Data("PhoneDex artifact".utf8)
        let digest = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()

        URLProtocolStub.handler = { request in
            XCTAssertEqual(request.url?.absoluteString, "http://bridge.test/artifacts/artifact_download_1")
            XCTAssertEqual(request.value(forHTTPHeaderField: "authorization"), "Bearer secret")
            return (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "text/plain"]
                )!,
                bytes
            )
        }

        let artifact = PhoneDexArtifact(
            id: "build-log",
            name: "Build log",
            kind: "log",
            sourceRef: "artifacts/build.log",
            sizeBytes: bytes.count,
            sha256: digest,
            downloadId: "artifact_download_1",
            mediaType: "text/plain"
        )
        let downloaded = try await PhoneDexBridgeClient(
            bridgeURL: URL(string: "http://bridge.test")!,
            token: "secret",
            session: session
        ).downloadArtifact(artifact)

        XCTAssertEqual(downloaded, bytes)
    }

    func testDownloadArtifactRejectsDigestMismatchBeforeSharing() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [URLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        URLProtocolStub.handler = { request in
            (
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["content-type": "text/plain"]
                )!,
                Data("tampered".utf8)
            )
        }

        let artifact = PhoneDexArtifact(
            id: "build-log",
            name: "Build log",
            kind: "log",
            sourceRef: "artifacts/build.log",
            sizeBytes: 5,
            sha256: String(repeating: "0", count: 64),
            downloadId: "artifact_download_1",
            mediaType: "text/plain"
        )
        do {
            _ = try await PhoneDexBridgeClient(
                bridgeURL: URL(string: "http://bridge.test")!,
                token: "secret",
                session: session
            ).downloadArtifact(artifact)
            XCTFail("Expected digest mismatch")
        } catch let error as PhoneDexBridgeClientError {
            if case .artifactIntegrityFailed = error {
                // Expected: never offer bytes that fail the declared digest.
            } else {
                XCTFail("Unexpected artifact error: \(error)")
            }
        }
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
