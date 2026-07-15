import Foundation
import Security

protocol PhoneDexTokenStoring {
    func readToken() throws -> String?
    func writeToken(_ token: String) throws
    func removeToken() throws
}

struct PhoneDexKeychainTokenStore: PhoneDexTokenStoring {
    private let service: String
    private let account: String

    init(
        service: String = "com.nash226.PhoneDex.credentials",
        account: String = "bridge-token"
    ) {
        self.service = service
        self.account = account
    }

    func readToken() throws -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status != errSecItemNotFound else { return nil }
        guard status == errSecSuccess else {
            throw PhoneDexKeychainError.keychain(status)
        }
        guard let data = result as? Data,
              let token = String(data: data, encoding: .utf8)
        else {
            throw PhoneDexKeychainError.invalidTokenData
        }
        return token
    }

    func writeToken(_ token: String) throws {
        let data = Data(token.utf8)
        let update = [kSecValueData as String: data]
        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)

        if updateStatus == errSecItemNotFound {
            var item = baseQuery
            item[kSecValueData as String] = data
            item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else {
                throw PhoneDexKeychainError.keychain(addStatus)
            }
            return
        }

        guard updateStatus == errSecSuccess else {
            throw PhoneDexKeychainError.keychain(updateStatus)
        }
    }

    func removeToken() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw PhoneDexKeychainError.keychain(status)
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

enum PhoneDexKeychainError: LocalizedError, Equatable {
    case keychain(OSStatus)
    case invalidTokenData

    var errorDescription: String? {
        switch self {
        case .keychain:
            return "Secure credential storage is unavailable. Try again."
        case .invalidTokenData:
            return "The saved bridge credential could not be read."
        }
    }
}
