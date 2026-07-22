import CryptoKit
import Foundation
import Security

enum PhoneDexPresentationMetadataPolicy {
    /// Presentation state is keyed by the task currently shown on iPhone.
    /// Once a complete sync replaces that projection, orphaned keys should
    /// not keep task-derived state alive indefinitely in the encrypted cache.
    static func prune<Value>(_ metadata: [String: Value], keeping taskIDs: Set<String>) -> [String: Value] {
        metadata.filter { taskIDs.contains($0.key) }
    }
}

struct PhoneDexCachedState: Codable, Equatable {
    static let currentSchema = "phonedex.ios-cache.v1"
    static let currentVersion = 1

    let schema: String
    let version: Int
    let cursor: String?
    let tasks: [PhoneDexTask]
    let devices: [PhoneDexDevice]
    let events: [PhoneDexEvent]
    let lastSyncAt: Date?
    let drafts: [String: String]
    let readingPositions: [String: String]
    let readAt: [String: Date]
    let archivedAt: [String: Date]
    let mutedAt: [String: Date]
    let pendingReplies: [PhoneDexPendingReply]
    let pendingLifecycleCommands: [PhoneDexPendingLifecycleCommand]
    let replyReceipts: [PhoneDexReplyDeliveryRecord]
    let lifecycleReceipts: [PhoneDexLifecycleDeliveryRecord]
    let handledNotificationResponses: [String: Date]
    let cachedArtifacts: [PhoneDexCachedArtifact]

    private enum CodingKeys: String, CodingKey {
        case schema, version, cursor, tasks, devices, events, lastSyncAt, drafts, readingPositions, readAt, archivedAt, mutedAt, pendingReplies, pendingLifecycleCommands, replyReceipts, lifecycleReceipts, handledNotificationResponses, cachedArtifacts
    }

    init(
        cursor: String?,
        tasks: [PhoneDexTask],
        devices: [PhoneDexDevice],
        events: [PhoneDexEvent] = [],
        lastSyncAt: Date?,
        drafts: [String: String] = [:],
        readingPositions: [String: String] = [:],
        readAt: [String: Date] = [:],
        archivedAt: [String: Date] = [:],
        mutedAt: [String: Date] = [:],
        pendingReplies: [PhoneDexPendingReply] = [],
        pendingLifecycleCommands: [PhoneDexPendingLifecycleCommand] = [],
        replyReceipts: [PhoneDexReplyDeliveryRecord] = [],
        lifecycleReceipts: [PhoneDexLifecycleDeliveryRecord] = [],
        handledNotificationResponses: [String: Date] = [:],
        cachedArtifacts: [PhoneDexCachedArtifact] = [],
        schema: String = PhoneDexCachedState.currentSchema,
        version: Int = PhoneDexCachedState.currentVersion
    ) {
        self.schema = schema
        self.version = version
        self.cursor = cursor
        self.tasks = tasks
        self.devices = devices
        self.events = events
        self.lastSyncAt = lastSyncAt
        self.drafts = drafts
        self.readingPositions = readingPositions
        self.readAt = readAt
        self.archivedAt = archivedAt
        self.mutedAt = mutedAt
        self.pendingReplies = pendingReplies
        self.pendingLifecycleCommands = pendingLifecycleCommands
        self.replyReceipts = replyReceipts
        self.lifecycleReceipts = lifecycleReceipts
        self.handledNotificationResponses = handledNotificationResponses
        self.cachedArtifacts = cachedArtifacts
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schema = try container.decode(String.self, forKey: .schema)
        version = try container.decode(Int.self, forKey: .version)
        cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        guard container.contains(.tasks) else { throw DecodingError.keyNotFound(CodingKeys.tasks, .init(codingPath: decoder.codingPath, debugDescription: "cache.tasks must be present")) }
        guard container.contains(.devices) else { throw DecodingError.keyNotFound(CodingKeys.devices, .init(codingPath: decoder.codingPath, debugDescription: "cache.devices must be present")) }
        tasks = try PhoneDexNativeDecodeBounds.array(PhoneDexTask.self, from: container, forKey: .tasks, max: PhoneDexNativeDecodeBounds.cachedTasks, name: "cache.tasks", decoder: decoder)
        devices = try PhoneDexNativeDecodeBounds.array(PhoneDexDevice.self, from: container, forKey: .devices, max: PhoneDexNativeDecodeBounds.cachedDevices, name: "cache.devices", decoder: decoder)
        events = try PhoneDexNativeDecodeBounds.array(PhoneDexEvent.self, from: container, forKey: .events, max: PhoneDexNativeDecodeBounds.cachedEvents, name: "cache.events", decoder: decoder)
        lastSyncAt = try container.decodeIfPresent(Date.self, forKey: .lastSyncAt)
        drafts = try PhoneDexNativeDecodeBounds.dictionary(String.self, from: container, forKey: .drafts, max: PhoneDexNativeDecodeBounds.cachedPresentationMetadata, name: "cache.drafts", decoder: decoder)
        readingPositions = try PhoneDexNativeDecodeBounds.dictionary(String.self, from: container, forKey: .readingPositions, max: PhoneDexNativeDecodeBounds.cachedPresentationMetadata, name: "cache.readingPositions", decoder: decoder)
        readAt = try PhoneDexNativeDecodeBounds.dictionary(Date.self, from: container, forKey: .readAt, max: PhoneDexNativeDecodeBounds.cachedPresentationMetadata, name: "cache.readAt", decoder: decoder)
        archivedAt = try PhoneDexNativeDecodeBounds.dictionary(Date.self, from: container, forKey: .archivedAt, max: PhoneDexNativeDecodeBounds.cachedPresentationMetadata, name: "cache.archivedAt", decoder: decoder)
        mutedAt = try PhoneDexNativeDecodeBounds.dictionary(Date.self, from: container, forKey: .mutedAt, max: PhoneDexNativeDecodeBounds.cachedPresentationMetadata, name: "cache.mutedAt", decoder: decoder)
        pendingReplies = try PhoneDexNativeDecodeBounds.array(PhoneDexPendingReply.self, from: container, forKey: .pendingReplies, max: PhoneDexNativeDecodeBounds.cachedPendingReplies, name: "cache.pendingReplies", decoder: decoder)
        pendingLifecycleCommands = try PhoneDexNativeDecodeBounds.array(PhoneDexPendingLifecycleCommand.self, from: container, forKey: .pendingLifecycleCommands, max: PhoneDexNativeDecodeBounds.cachedPendingLifecycleCommands, name: "cache.pendingLifecycleCommands", decoder: decoder)
        replyReceipts = try PhoneDexNativeDecodeBounds.array(PhoneDexReplyDeliveryRecord.self, from: container, forKey: .replyReceipts, max: PhoneDexNativeDecodeBounds.cachedReplyReceipts, name: "cache.replyReceipts", decoder: decoder)
        lifecycleReceipts = try PhoneDexNativeDecodeBounds.array(PhoneDexLifecycleDeliveryRecord.self, from: container, forKey: .lifecycleReceipts, max: PhoneDexNativeDecodeBounds.cachedLifecycleReceipts, name: "cache.lifecycleReceipts", decoder: decoder)
        handledNotificationResponses = try PhoneDexNativeDecodeBounds.dictionary(Date.self, from: container, forKey: .handledNotificationResponses, max: PhoneDexNativeDecodeBounds.cachedNotificationResponses, name: "cache.handledNotificationResponses", decoder: decoder)
        cachedArtifacts = try PhoneDexNativeDecodeBounds.array(PhoneDexCachedArtifact.self, from: container, forKey: .cachedArtifacts, max: PhoneDexNativeDecodeBounds.cachedArtifacts, name: "cache.cachedArtifacts", decoder: decoder)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schema, forKey: .schema)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(cursor, forKey: .cursor)
        try container.encode(tasks, forKey: .tasks)
        try container.encode(devices, forKey: .devices)
        try container.encode(events, forKey: .events)
        try container.encodeIfPresent(lastSyncAt, forKey: .lastSyncAt)
        try container.encode(drafts, forKey: .drafts)
        try container.encode(readingPositions, forKey: .readingPositions)
        try container.encode(readAt, forKey: .readAt)
        try container.encode(archivedAt, forKey: .archivedAt)
        try container.encode(mutedAt, forKey: .mutedAt)
        try container.encode(pendingReplies, forKey: .pendingReplies)
        try container.encode(pendingLifecycleCommands, forKey: .pendingLifecycleCommands)
        try container.encode(replyReceipts, forKey: .replyReceipts)
        try container.encode(lifecycleReceipts, forKey: .lifecycleReceipts)
        try container.encode(handledNotificationResponses, forKey: .handledNotificationResponses)
        try container.encode(cachedArtifacts, forKey: .cachedArtifacts)
    }

    func replacingNotificationState(
        pendingReplies: [PhoneDexPendingReply]? = nil,
        pendingLifecycleCommands: [PhoneDexPendingLifecycleCommand]? = nil,
        handledNotificationResponses: [String: Date]? = nil
    ) -> PhoneDexCachedState {
        PhoneDexCachedState(
            cursor: cursor,
            tasks: tasks,
            devices: devices,
            events: events,
            lastSyncAt: lastSyncAt,
            drafts: drafts,
            readingPositions: readingPositions,
            readAt: readAt,
            archivedAt: archivedAt,
            mutedAt: mutedAt,
            pendingReplies: pendingReplies ?? self.pendingReplies,
            pendingLifecycleCommands: pendingLifecycleCommands ?? self.pendingLifecycleCommands,
            replyReceipts: replyReceipts,
            lifecycleReceipts: lifecycleReceipts,
            handledNotificationResponses: handledNotificationResponses ?? self.handledNotificationResponses,
            cachedArtifacts: cachedArtifacts,
            schema: schema,
            version: version
        )
    }
}

struct PhoneDexPendingLifecycleCommand: Codable, Equatable, Identifiable {
    let commandId: String
    let idempotencyKey: String
    let kind: String
    let taskId: String
    let expectedTaskVersion: Int
    let createdAt: Date

    var id: String { idempotencyKey }

    var actionLabel: String {
        switch kind {
        case "cancel": return "Cancellation"
        case "retry": return "Retry"
        default: return "Offline action"
        }
    }

    var queuedMessage: String {
        "\(actionLabel) is queued until the hub reconnects."
    }
}

struct PhoneDexLifecycleDeliveryRecord: Codable, Equatable, Identifiable {
    let commandId: String
    let idempotencyKey: String?
    let kind: String
    let taskId: String
    let state: String
    let message: String?
    let taskVersion: Int?
    let serverCreatedAt: String?
    let recordedAt: Date

    var id: String { commandId }

    var isSuccessful: Bool {
        ["accepted", "completed", "duplicate"].contains(state)
    }

    var displayState: String {
        switch state {
        case "accepted": return "Accepted by hub"
        case "completed": return "Delivered to agent"
        case "duplicate": return "Already delivered"
        case "rejected": return "Rejected by agent"
        case "expired": return "Expired"
        case "stale": return "Stale task version"
        default: return state.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var actionLabel: String {
        switch kind {
        case "cancel": return "Cancellation"
        case "retry": return "Retry"
        case "approve": return "Approval"
        case "reject": return "Rejection"
        case "handoff": return "Desktop handoff"
        case "create": return "Task creation"
        default: return "Managed action"
        }
    }

    /// A receipt is current only when its task-version evidence matches the
    /// task currently shown. Versioned receipts must never be presented as the
    /// outcome of a newer task projection.
    func matchesCurrentTaskVersion(_ currentTaskVersion: Int?) -> Bool {
        taskVersion == currentTaskVersion
    }

    init(receipt: PhoneDexReplyReceipt, kind: String, taskId: String, recordedAt: Date = Date()) {
        commandId = receipt.commandId
        idempotencyKey = receipt.idempotencyKey
        self.kind = kind
        self.taskId = receipt.taskId ?? taskId
        state = receipt.state
        message = receipt.message
        taskVersion = receipt.taskVersion
        serverCreatedAt = receipt.createdAt
        self.recordedAt = recordedAt
    }
}

enum PhoneDexPendingLifecycleCommandPolicy {
    static let retention: TimeInterval = 7 * 24 * 60 * 60
    static let limit = 10
    static let supportedKinds: Set<String> = ["cancel", "retry"]

    static func prune(_ commands: [PhoneDexPendingLifecycleCommand], now: Date) -> [PhoneDexPendingLifecycleCommand] {
        commands
            .filter { supportedKinds.contains($0.kind) && now.timeIntervalSince($0.createdAt) < retention }
            .sorted { $0.createdAt > $1.createdAt }
            .prefix(limit)
            .map { $0 }
    }
}

struct PhoneDexCachedArtifact: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let mediaType: String?
    let data: Data
    let downloadedAt: Date

    var byteCount: Int { data.count }
}

enum PhoneDexCachedArtifactPolicy {
    static let retention: TimeInterval = 30 * 24 * 60 * 60
    static let limit = 20
    static let bytesLimit = 25 * 1024 * 1024

    static func index(_ artifacts: [PhoneDexCachedArtifact]) -> [String: PhoneDexCachedArtifact] {
        Dictionary(
            artifacts.map { ($0.id, $0) },
            uniquingKeysWith: { _, latest in latest }
        )
    }

    static func prune(_ artifacts: [PhoneDexCachedArtifact], now: Date) -> [PhoneDexCachedArtifact] {
        let recent = artifacts.filter { now.timeIntervalSince($0.downloadedAt) < retention }
        var retained = [PhoneDexCachedArtifact]()
        var totalBytes = 0
        for artifact in recent.sorted(by: { $0.downloadedAt > $1.downloadedAt }) where retained.count < limit {
            guard totalBytes + artifact.byteCount <= bytesLimit else { continue }
            retained.append(artifact)
            totalBytes += artifact.byteCount
        }
        return retained
    }
}

struct PhoneDexReplyDeliveryRecord: Codable, Equatable, Identifiable {
    let commandId: String
    let idempotencyKey: String?
    let taskId: String
    let prompt: String
    let state: String
    let message: String?
    let taskVersion: Int?
    let serverCreatedAt: String?
    let recordedAt: Date

    var id: String { commandId }

    var isSuccessful: Bool {
        ["accepted", "completed", "duplicate"].contains(state)
    }

    var displayState: String {
        switch state {
        case "accepted": return "Accepted by hub"
        case "completed": return "Delivered to agent"
        case "duplicate": return "Already delivered"
        case "rejected": return "Rejected by agent"
        case "expired": return "Expired"
        case "stale": return "Stale task version"
        default: return state.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    init(receipt: PhoneDexReplyReceipt, pending: PhoneDexPendingReply, recordedAt: Date = Date()) {
        commandId = receipt.commandId
        idempotencyKey = receipt.idempotencyKey ?? pending.idempotencyKey
        taskId = receipt.taskId ?? pending.taskId
        prompt = pending.prompt
        state = receipt.state
        message = receipt.message
        taskVersion = receipt.taskVersion
        serverCreatedAt = receipt.createdAt
        self.recordedAt = recordedAt
    }
}

struct PhoneDexPendingReply: Codable, Equatable, Identifiable {
    let commandId: String
    let idempotencyKey: String
    let taskId: String
    let choice: String
    let prompt: String
    let expectedTaskVersion: Int
    let sessionId: String?
    let machineName: String?
    let createdAt: Date
    let questionId: String?
    let questionResponse: PhoneDexQuestionResponse?

    private enum CodingKeys: String, CodingKey {
        case commandId, idempotencyKey, taskId, choice, prompt, expectedTaskVersion
        case sessionId, machineName, createdAt, questionId, questionResponse
    }

    init(
        commandId: String,
        idempotencyKey: String,
        taskId: String,
        choice: String,
        prompt: String,
        expectedTaskVersion: Int,
        sessionId: String?,
        machineName: String?,
        createdAt: Date,
        questionId: String? = nil,
        questionResponse: PhoneDexQuestionResponse? = nil
    ) {
        self.commandId = commandId
        self.idempotencyKey = idempotencyKey
        self.taskId = taskId
        self.choice = choice
        self.prompt = prompt
        self.expectedTaskVersion = expectedTaskVersion
        self.sessionId = sessionId
        self.machineName = machineName
        self.createdAt = createdAt
        self.questionId = questionId
        self.questionResponse = questionResponse
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        commandId = try container.decode(String.self, forKey: .commandId)
        idempotencyKey = try container.decode(String.self, forKey: .idempotencyKey)
        taskId = try container.decode(String.self, forKey: .taskId)
        choice = try container.decode(String.self, forKey: .choice)
        prompt = try container.decode(String.self, forKey: .prompt)
        expectedTaskVersion = try container.decode(Int.self, forKey: .expectedTaskVersion)
        sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId)
        machineName = try container.decodeIfPresent(String.self, forKey: .machineName)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        questionId = try container.decodeIfPresent(String.self, forKey: .questionId)
        questionResponse = try container.decodeIfPresent(PhoneDexQuestionResponse.self, forKey: .questionResponse)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(commandId, forKey: .commandId)
        try container.encode(idempotencyKey, forKey: .idempotencyKey)
        try container.encode(taskId, forKey: .taskId)
        try container.encode(choice, forKey: .choice)
        try container.encode(prompt, forKey: .prompt)
        try container.encode(expectedTaskVersion, forKey: .expectedTaskVersion)
        try container.encodeIfPresent(sessionId, forKey: .sessionId)
        try container.encodeIfPresent(machineName, forKey: .machineName)
        try container.encode(createdAt, forKey: .createdAt)
        try container.encodeIfPresent(questionId, forKey: .questionId)
        try container.encodeIfPresent(questionResponse, forKey: .questionResponse)
    }

    var id: String { idempotencyKey }
}

enum PhoneDexPendingReplyPolicy {
    static let retention: TimeInterval = 7 * 24 * 60 * 60
    static let limit = 20
    static let promptBytesLimit = 64 * 1024
    static let bytesLimit = 256 * 1024

    static func promptByteCount(_ pending: PhoneDexPendingReply) -> Int {
        pending.prompt.utf8.count
    }

    static func isAcceptable(_ pending: PhoneDexPendingReply) -> Bool {
        promptByteCount(pending) <= promptBytesLimit
    }

    static func prune(_ pendingReplies: [PhoneDexPendingReply], now: Date) -> [PhoneDexPendingReply] {
        let recent = pendingReplies.filter {
            now.timeIntervalSince($0.createdAt) < retention && isAcceptable($0)
        }
        var retained = [PhoneDexPendingReply]()
        var totalBytes = 0
        for pending in recent.sorted(by: { $0.createdAt > $1.createdAt }) where retained.count < limit {
            let bytes = promptByteCount(pending)
            guard totalBytes + bytes <= bytesLimit else { continue }
            retained.append(pending)
            totalBytes += bytes
        }
        return retained
    }
}

protocol PhoneDexCacheStoring {
    func load() throws -> PhoneDexCachedState?
    func save(_ state: PhoneDexCachedState) throws
    func remove() throws
    func quarantine() throws
    var byteCount: Int64? { get }
}

extension PhoneDexCacheStoring {
    /// Test doubles and non-file stores have nothing to quarantine.
    func quarantine() throws {}

    /// A non-file cache cannot safely report its storage footprint.
    var byteCount: Int64? { nil }
}

protocol PhoneDexCacheKeyStoring {
    func readKey() throws -> Data?
    func writeKey(_ key: Data) throws
    func removeKey() throws
}

struct PhoneDexEncryptedCache: PhoneDexCacheStoring {
    private let fileURL: URL
    private let keyStore: any PhoneDexCacheKeyStoring

    init(
        fileURL: URL = PhoneDexEncryptedCache.defaultFileURL(),
        keyStore: any PhoneDexCacheKeyStoring = PhoneDexKeychainCacheKeyStore()
    ) {
        self.fileURL = fileURL
        self.keyStore = keyStore
    }

    /// Returns only the encrypted container size; plaintext content and the
    /// cache path never leave this process.
    var byteCount: Int64? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return 0 }
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
            return attributes[.size] as? Int64
        } catch {
            return nil
        }
    }

    func load() throws -> PhoneDexCachedState? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }

        let encrypted = try Data(contentsOf: fileURL)
        let sealedBox: AES.GCM.SealedBox
        do {
            sealedBox = try AES.GCM.SealedBox(combined: encrypted)
        } catch {
            throw PhoneDexCacheError.invalidData
        }

        do {
            let plaintext = try AES.GCM.open(sealedBox, using: try encryptionKey())
            let state = try JSONDecoder().decode(PhoneDexCachedState.self, from: plaintext)
            guard state.schema == PhoneDexCachedState.currentSchema,
                  state.version == PhoneDexCachedState.currentVersion
            else { throw PhoneDexCacheError.invalidData }
            return state
        } catch let error as PhoneDexCacheError {
            throw error
        } catch {
            throw PhoneDexCacheError.invalidData
        }
    }

    func save(_ state: PhoneDexCachedState) throws {
        let plaintext = try JSONEncoder().encode(state)
        let sealedBox: AES.GCM.SealedBox
        do {
            sealedBox = try AES.GCM.seal(plaintext, using: try encryptionKey())
        } catch let error as PhoneDexCacheError {
            throw error
        } catch {
            throw PhoneDexCacheError.encryptionFailed
        }

        let directory = fileURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        do {
            guard let combined = sealedBox.combined else {
                throw PhoneDexCacheError.encryptionFailed
            }
            try combined.write(
                to: fileURL,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch let error as PhoneDexCacheError {
            throw error
        } catch {
            throw PhoneDexCacheError.persistenceFailed
        }
    }

    func remove() throws {
        do {
            if FileManager.default.fileExists(atPath: fileURL.path) {
                try FileManager.default.removeItem(at: fileURL)
            }
            try keyStore.removeKey()
        } catch let error as PhoneDexCacheError {
            throw error
        } catch {
            throw PhoneDexCacheError.persistenceFailed
        }
    }

    func quarantine() throws {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return }

        let quarantineURL = fileURL
            .deletingLastPathComponent()
            .appendingPathComponent("\(fileURL.deletingPathExtension().lastPathComponent).corrupt-\(UUID().uuidString).\(fileURL.pathExtension)")
        do {
            try FileManager.default.moveItem(at: fileURL, to: quarantineURL)
        } catch {
            throw PhoneDexCacheError.persistenceFailed
        }
    }

    private func encryptionKey() throws -> SymmetricKey {
        if let storedKey = try keyStore.readKey() {
            guard storedKey.count == 32 else { throw PhoneDexCacheError.invalidKey }
            return SymmetricKey(data: storedKey)
        }

        let key = SymmetricKey(size: .bits256)
        let keyData = key.withUnsafeBytes { Data($0) }
        try keyStore.writeKey(keyData)
        return key
    }

    static func defaultFileURL(fileManager: FileManager = .default) -> URL {
        let directory = (fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.temporaryDirectory)
            .appendingPathComponent("PhoneDex", isDirectory: true)
        return directory.appendingPathComponent("sync-cache.bin")
    }
}

struct PhoneDexKeychainCacheKeyStore: PhoneDexCacheKeyStoring {
    private let service: String
    private let account: String

    init(
        service: String = "com.nash226.PhoneDex.cache",
        account: String = "sync-cache-key"
    ) {
        self.service = service
        self.account = account
    }

    func readKey() throws -> Data? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status != errSecItemNotFound else { return nil }
        guard status == errSecSuccess else { throw PhoneDexCacheError.keychain(status) }
        guard let data = result as? Data else { throw PhoneDexCacheError.invalidKey }
        return data
    }

    func writeKey(_ key: Data) throws {
        let updateStatus = SecItemUpdate(
            baseQuery as CFDictionary,
            [kSecValueData as String: key] as CFDictionary
        )
        if updateStatus == errSecItemNotFound {
            var item = baseQuery
            item[kSecValueData as String] = key
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw PhoneDexCacheError.keychain(addStatus) }
            return
        }
        guard updateStatus == errSecSuccess else { throw PhoneDexCacheError.keychain(updateStatus) }
    }

    func removeKey() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw PhoneDexCacheError.keychain(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
    }
}

enum PhoneDexCacheError: LocalizedError, Equatable {
    case keychain(OSStatus)
    case invalidKey
    case invalidData
    case encryptionFailed
    case persistenceFailed

    var errorDescription: String? {
        switch self {
        case .keychain, .invalidKey:
            return "Secure local cache storage is unavailable."
        case .invalidData, .encryptionFailed, .persistenceFailed:
            return "PhoneDex could not restore its local cache."
        }
    }
}
