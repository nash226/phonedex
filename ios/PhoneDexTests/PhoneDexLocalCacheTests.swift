import XCTest
@testable import PhoneDex

final class PhoneDexLocalCacheTests: XCTestCase {
    func testDefaultCachePathUsesApplicationSupportWhenAvailable() {
        let path = PhoneDexEncryptedCache.defaultFileURL()

        XCTAssertEqual(path.lastPathComponent, "sync-cache.bin")
        XCTAssertEqual(path.deletingLastPathComponent().lastPathComponent, "PhoneDex")
    }

    func testCacheEncryptsAndRestoresCursorAndState() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PhoneDexLocalCacheTests-\(UUID().uuidString)", isDirectory: true)
        let fileURL = root.appendingPathComponent("cache.bin")
        let keyStore = InMemoryCacheKeyStore()
        let cache = PhoneDexEncryptedCache(fileURL: fileURL, keyStore: keyStore)
        defer { try? FileManager.default.removeItem(at: root) }

        let pendingReply = PhoneDexPendingReply(
            commandId: "command_123",
            idempotencyKey: "reply_123",
            taskId: "task_123",
            choice: "custom",
            prompt: "Keep going",
            expectedTaskVersion: 3,
            sessionId: "thread_123",
            machineName: "Studio Mac",
            createdAt: Date(timeIntervalSince1970: 1_750_000_001),
            questionId: "next-step",
            questionResponse: .choice("tests")
        )
        let state = PhoneDexCachedState(
            cursor: "cursor.v1",
            tasks: [task(id: "task_123")],
            devices: [],
            events: [event(taskID: "task_123")],
            lastSyncAt: Date(timeIntervalSince1970: 1_750_000_000),
            drafts: ["task_123": "Keep the next reply focused"],
            readingPositions: ["task_123": "activity"],
            pendingReplies: [pendingReply],
            replyReceipts: [PhoneDexReplyDeliveryRecord(
                receipt: PhoneDexReplyReceipt(
                    schema: "phonedex.command-receipt.v1",
                    protocolVersion: 1,
                    commandId: "command_123",
                    createdAt: "2026-07-15T12:00:02.000Z",
                    state: "completed",
                    taskId: "task_123",
                    taskVersion: 4,
                    idempotencyKey: "reply_123",
                    message: "Delivered to Studio Mac",
                    duplicateOf: nil,
                    approvalId: nil,
                    approvalState: nil,
                    approvalExpiresAt: nil
                ),
                pending: pendingReply,
                recordedAt: Date(timeIntervalSince1970: 1_750_000_002)
            )],
            handledNotificationResponses: ["notification-123|PHONEDEX_OKAY_WHATS_NEXT": Date(timeIntervalSince1970: 1_750_000_003)],
            cachedArtifacts: [PhoneDexCachedArtifact(
                id: "artifact_123",
                name: "build.log",
                mediaType: "text/plain",
                data: Data("private artifact".utf8),
                downloadedAt: Date(timeIntervalSince1970: 1_750_000_004)
            )]
        )

        try cache.save(state)
        let encrypted = try Data(contentsOf: fileURL)
        XCTAssertFalse(String(data: encrypted, encoding: .utf8)?.contains("private result") == true)
        XCTAssertEqual(try cache.load(), state)
        XCTAssertEqual(try cache.load()?.pendingReplies.first?.questionId, "next-step")
        XCTAssertEqual(try cache.load()?.pendingReplies.first?.questionResponse, .choice("tests"))
        XCTAssertEqual(try cache.load()?.replyReceipts.first?.displayState, "Delivered to agent")
        XCTAssertEqual(try cache.load()?.replyReceipts.first?.message, "Delivered to Studio Mac")
        XCTAssertEqual(try cache.load()?.events.first?.type, "progress")
        XCTAssertEqual(try cache.load()?.handledNotificationResponses.count, 1)
        XCTAssertEqual(try cache.load()?.cachedArtifacts.first?.data, Data("private artifact".utf8))
        XCTAssertEqual(keyStore.key?.count, 32)

        try cache.remove()
        XCTAssertNil(try cache.load())
        XCTAssertNil(keyStore.key)
    }

    func testLegacyCacheWithoutReadingPositionRemainsReadable() throws {
        let state = PhoneDexCachedState(
            cursor: "cursor.v1",
            tasks: [task(id: "task_legacy")],
            devices: [],
            lastSyncAt: nil,
            drafts: ["task_legacy": "Draft"]
        )
        let encoded = try JSONEncoder().encode(state)
        var legacyObject = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        legacyObject.removeValue(forKey: "readingPositions")
        let legacyData = try JSONSerialization.data(withJSONObject: legacyObject)

        let decoded = try JSONDecoder().decode(PhoneDexCachedState.self, from: legacyData)

        XCTAssertEqual(decoded.drafts["task_legacy"], "Draft")
        XCTAssertTrue(decoded.readingPositions.isEmpty)
        XCTAssertTrue(decoded.replyReceipts.isEmpty)
        XCTAssertTrue(decoded.handledNotificationResponses.isEmpty)
        XCTAssertTrue(decoded.cachedArtifacts.isEmpty)
    }

    func testTamperedCacheFailsClosedWithoutReturningPartialState() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PhoneDexLocalCacheTests-\(UUID().uuidString)", isDirectory: true)
        let fileURL = root.appendingPathComponent("cache.bin")
        let keyStore = InMemoryCacheKeyStore()
        let cache = PhoneDexEncryptedCache(fileURL: fileURL, keyStore: keyStore)
        defer { try? FileManager.default.removeItem(at: root) }

        try cache.save(PhoneDexCachedState(cursor: "cursor", tasks: [task(id: "private")], devices: [], lastSyncAt: nil))
        var bytes = try Data(contentsOf: fileURL)
        bytes[bytes.startIndex] ^= 0xff
        try bytes.write(to: fileURL)

        XCTAssertThrowsError(try cache.load()) { error in
            XCTAssertEqual(error as? PhoneDexCacheError, .invalidData)
        }
    }

    func testQuarantineMovesTamperedCacheAsideForFreshRecovery() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PhoneDexLocalCacheTests-\(UUID().uuidString)", isDirectory: true)
        let fileURL = root.appendingPathComponent("cache.bin")
        let keyStore = InMemoryCacheKeyStore()
        let cache = PhoneDexEncryptedCache(fileURL: fileURL, keyStore: keyStore)
        defer { try? FileManager.default.removeItem(at: root) }

        try cache.save(PhoneDexCachedState(cursor: "cursor", tasks: [task(id: "private")], devices: [], lastSyncAt: nil))
        try cache.quarantine()

        XCTAssertFalse(FileManager.default.fileExists(atPath: fileURL.path))
        let quarantined = try FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
        XCTAssertEqual(quarantined.count, 1)
        XCTAssertTrue(quarantined[0].lastPathComponent.hasPrefix("cache.corrupt-"))
        XCTAssertNil(try cache.load())
        XCTAssertEqual(keyStore.key?.count, 32)
    }

    func testCachedArtifactPolicyExpiresOldEntriesAndBoundsRecentStorage() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let old = PhoneDexCachedArtifact(
            id: "old", name: "old.log", mediaType: "text/plain",
            data: Data("old".utf8), downloadedAt: now.addingTimeInterval(-PhoneDexCachedArtifactPolicy.retention - 1)
        )
        let recent = (0..<PhoneDexCachedArtifactPolicy.limit + 2).map { index in
            PhoneDexCachedArtifact(
                id: "recent-\(index)", name: "recent.log", mediaType: "text/plain",
                data: Data("recent-\(index)".utf8), downloadedAt: now.addingTimeInterval(-Double(index))
            )
        }

        let retained = PhoneDexCachedArtifactPolicy.prune([old] + recent, now: now)

        XCTAssertFalse(retained.contains(old))
        XCTAssertEqual(retained.count, PhoneDexCachedArtifactPolicy.limit)
        XCTAssertEqual(retained.first?.id, "recent-0")
        XCTAssertLessThanOrEqual(retained.reduce(0) { $0 + $1.byteCount }, PhoneDexCachedArtifactPolicy.bytesLimit)
    }

    func testCachedArtifactIndexKeepsLatestDuplicateWithoutTrapping() {
        let first = PhoneDexCachedArtifact(
            id: "artifact-duplicate", name: "old.log", mediaType: "text/plain",
            data: Data("old".utf8), downloadedAt: Date(timeIntervalSince1970: 1)
        )
        let latest = PhoneDexCachedArtifact(
            id: "artifact-duplicate", name: "latest.log", mediaType: "text/plain",
            data: Data("latest".utf8), downloadedAt: Date(timeIntervalSince1970: 2)
        )

        let indexed = PhoneDexCachedArtifactPolicy.index([first, latest])

        XCTAssertEqual(indexed.count, 1)
        XCTAssertEqual(indexed["artifact-duplicate"]?.name, "latest.log")
        XCTAssertEqual(indexed["artifact-duplicate"]?.data, Data("latest".utf8))
    }

    func testPendingReplyPolicyExpiresAndBoundsSensitiveOutbox() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let old = pendingReply(id: "old", createdAt: now.addingTimeInterval(-PhoneDexPendingReplyPolicy.retention - 1))
        let oversized = pendingReply(
            id: "oversized",
            prompt: String(repeating: "x", count: PhoneDexPendingReplyPolicy.promptBytesLimit + 1),
            createdAt: now
        )
        let recent = (0..<PhoneDexPendingReplyPolicy.limit + 2).map { index in
            pendingReply(id: "recent-\(index)", prompt: "Reply \(index)", createdAt: now.addingTimeInterval(-Double(index)))
        }

        let retained = PhoneDexPendingReplyPolicy.prune([old, oversized] + recent, now: now)

        XCTAssertFalse(retained.contains(old))
        XCTAssertFalse(retained.contains(oversized))
        XCTAssertEqual(retained.count, PhoneDexPendingReplyPolicy.limit)
        XCTAssertEqual(retained.first?.id, "recent-0")
        XCTAssertLessThanOrEqual(
            retained.reduce(0) { $0 + PhoneDexPendingReplyPolicy.promptByteCount($1) },
            PhoneDexPendingReplyPolicy.bytesLimit
        )
    }

    func testPendingReplyPolicyKeepsNewestEntriesWhenByteBudgetIsReached() {
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let replies = (0..<5).map { index in
            pendingReply(
                id: "reply-\(index)",
                prompt: String(repeating: "x", count: PhoneDexPendingReplyPolicy.bytesLimit / 4),
                createdAt: now.addingTimeInterval(-Double(index))
            )
        }

        let retained = PhoneDexPendingReplyPolicy.prune(replies, now: now)

        XCTAssertEqual(retained.map(\.id), ["reply-0", "reply-1", "reply-2", "reply-3"])
    }

    func testNotificationStateReplacementPreservesLocalReviewAndSyncState() {
        let artifact = PhoneDexCachedArtifact(
            id: "artifact", name: "build.log", mediaType: "text/plain",
            data: Data("private review output".utf8), downloadedAt: Date(timeIntervalSince1970: 2)
        )
        let state = PhoneDexCachedState(
            cursor: "cursor.v1",
            tasks: [task(id: "task")],
            devices: [],
            events: [event(taskID: "task")],
            lastSyncAt: Date(timeIntervalSince1970: 1),
            drafts: ["task": "draft"],
            readingPositions: ["task": "activity"],
            pendingReplies: [],
            replyReceipts: [],
            handledNotificationResponses: [:],
            cachedArtifacts: [artifact]
        )

        let withPendingReply = state.replacingNotificationState(
            pendingReplies: [PhoneDexPendingReply(
                commandId: "command",
                idempotencyKey: "idempotency",
                taskId: "task",
                choice: "custom",
                prompt: "Continue",
                expectedTaskVersion: 1,
                sessionId: nil,
                machineName: nil,
                createdAt: Date(timeIntervalSince1970: 3)
            )]
        )
        let withHandledResponse = withPendingReply.replacingNotificationState(
            handledNotificationResponses: ["notification|action": Date(timeIntervalSince1970: 4)]
        )

        XCTAssertEqual(withHandledResponse.cursor, state.cursor)
        XCTAssertEqual(withHandledResponse.tasks, state.tasks)
        XCTAssertEqual(withHandledResponse.events, state.events)
        XCTAssertEqual(withHandledResponse.drafts, state.drafts)
        XCTAssertEqual(withHandledResponse.readingPositions, state.readingPositions)
        XCTAssertEqual(withHandledResponse.cachedArtifacts, state.cachedArtifacts)
        XCTAssertEqual(withHandledResponse.pendingReplies.count, 1)
        XCTAssertEqual(withHandledResponse.handledNotificationResponses.count, 1)
    }

    private func task(id: String) -> PhoneDexTask {
        PhoneDexTask(
            id: id,
            at: "2026-07-15T12:00:00.000Z",
            source: "codex",
            title: "Private task",
            text: "private result",
            cwd: nil,
            workspaceName: "PhoneDex",
            machineName: "Studio Mac",
            sessionId: nil,
            status: "completed",
            branch: nil,
            repository: nil
        )
    }

    private func event(taskID: String) -> PhoneDexEvent {
        PhoneDexEvent(
            id: "event_123",
            taskId: taskID,
            createdAt: "2026-07-15T12:00:01.000Z",
            sequence: 1,
            type: "progress",
            data: ["summary": "Running checks"]
        )
    }

    private func pendingReply(id: String, prompt: String = "Continue", createdAt: Date) -> PhoneDexPendingReply {
        PhoneDexPendingReply(
            commandId: "command-\(id)",
            idempotencyKey: id,
            taskId: "task",
            choice: "custom",
            prompt: prompt,
            expectedTaskVersion: 1,
            sessionId: "thread",
            machineName: "Studio Mac",
            createdAt: createdAt
        )
    }
}

private final class InMemoryCacheKeyStore: PhoneDexCacheKeyStoring {
    var key: Data?

    func readKey() throws -> Data? { key }
    func writeKey(_ key: Data) throws { self.key = key }
    func removeKey() throws { key = nil }
}
