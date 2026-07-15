import CryptoKit
import Foundation
import Security

struct PhoneDexCachedState: Codable, Equatable {
    static let currentSchema = "phonedex.ios-cache.v1"
    static let currentVersion = 1

    let schema: String
    let version: Int
    let cursor: String?
    let tasks: [PhoneDexTask]
    let devices: [PhoneDexDevice]
    let lastSyncAt: Date?
    let drafts: [String: String]
    let readingPositions: [String: String]

    private enum CodingKeys: String, CodingKey {
        case schema, version, cursor, tasks, devices, lastSyncAt, drafts, readingPositions
    }

    init(
        cursor: String?,
        tasks: [PhoneDexTask],
        devices: [PhoneDexDevice],
        lastSyncAt: Date?,
        drafts: [String: String] = [:],
        readingPositions: [String: String] = [:],
        schema: String = PhoneDexCachedState.currentSchema,
        version: Int = PhoneDexCachedState.currentVersion
    ) {
        self.schema = schema
        self.version = version
        self.cursor = cursor
        self.tasks = tasks
        self.devices = devices
        self.lastSyncAt = lastSyncAt
        self.drafts = drafts
        self.readingPositions = readingPositions
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schema = try container.decode(String.self, forKey: .schema)
        version = try container.decode(Int.self, forKey: .version)
        cursor = try container.decodeIfPresent(String.self, forKey: .cursor)
        tasks = try container.decode([PhoneDexTask].self, forKey: .tasks)
        devices = try container.decode([PhoneDexDevice].self, forKey: .devices)
        lastSyncAt = try container.decodeIfPresent(Date.self, forKey: .lastSyncAt)
        drafts = try container.decodeIfPresent([String: String].self, forKey: .drafts) ?? [:]
        readingPositions = try container.decodeIfPresent([String: String].self, forKey: .readingPositions) ?? [:]
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(schema, forKey: .schema)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(cursor, forKey: .cursor)
        try container.encode(tasks, forKey: .tasks)
        try container.encode(devices, forKey: .devices)
        try container.encodeIfPresent(lastSyncAt, forKey: .lastSyncAt)
        try container.encode(drafts, forKey: .drafts)
        try container.encode(readingPositions, forKey: .readingPositions)
    }
}

protocol PhoneDexCacheStoring {
    func load() throws -> PhoneDexCachedState?
    func save(_ state: PhoneDexCachedState) throws
    func remove() throws
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
        fileURL: URL = PhoneDexEncryptedCache.defaultFileURL,
        keyStore: any PhoneDexCacheKeyStoring = PhoneDexKeychainCacheKeyStore()
    ) {
        self.fileURL = fileURL
        self.keyStore = keyStore
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

    private static var defaultFileURL: URL {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
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
