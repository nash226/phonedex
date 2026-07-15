import XCTest
@testable import PhoneDex

final class PhoneDexLocalCacheTests: XCTestCase {
    func testCacheEncryptsAndRestoresCursorAndState() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PhoneDexLocalCacheTests-\(UUID().uuidString)", isDirectory: true)
        let fileURL = root.appendingPathComponent("cache.bin")
        let keyStore = InMemoryCacheKeyStore()
        let cache = PhoneDexEncryptedCache(fileURL: fileURL, keyStore: keyStore)
        defer { try? FileManager.default.removeItem(at: root) }

        let state = PhoneDexCachedState(
            cursor: "cursor.v1",
            tasks: [task(id: "task_123")],
            devices: [],
            events: [event(taskID: "task_123")],
            lastSyncAt: Date(timeIntervalSince1970: 1_750_000_000),
            drafts: ["task_123": "Keep the next reply focused"],
            readingPositions: ["task_123": "activity"],
            pendingReplies: [PhoneDexPendingReply(
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
            )]
        )

        try cache.save(state)
        let encrypted = try Data(contentsOf: fileURL)
        XCTAssertFalse(String(data: encrypted, encoding: .utf8)?.contains("private result") == true)
        XCTAssertEqual(try cache.load(), state)
        XCTAssertEqual(try cache.load()?.pendingReplies.first?.questionId, "next-step")
        XCTAssertEqual(try cache.load()?.pendingReplies.first?.questionResponse, .choice("tests"))
        XCTAssertEqual(try cache.load()?.events.first?.type, "progress")
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
}

private final class InMemoryCacheKeyStore: PhoneDexCacheKeyStoring {
    var key: Data?

    func readKey() throws -> Data? { key }
    func writeKey(_ key: Data) throws { self.key = key }
    func removeKey() throws { key = nil }
}
