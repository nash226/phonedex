import Foundation

@MainActor
final class PhoneDexSettings: ObservableObject {
    @Published var bridgeURL: String {
        didSet { defaults.set(bridgeURL, forKey: Keys.bridgeURL) }
    }

    @Published var token: String {
        didSet { persistToken() }
    }

    private let defaults: UserDefaults
    private let tokenStore: any PhoneDexTokenStoring

    @Published private(set) var credentialStorageError: String?

    init(
        defaults: UserDefaults = .standard,
        tokenStore: any PhoneDexTokenStoring = PhoneDexKeychainTokenStore()
    ) {
        self.defaults = defaults
        self.tokenStore = tokenStore

        let storedBridgeURL = defaults.string(forKey: Keys.bridgeURL) ?? "http://127.0.0.1:8765"
        var storedToken = ""
        var storageError: String?

        do {
            storedToken = try tokenStore.readToken() ?? ""
        } catch {
            storageError = Self.credentialStorageErrorMessage
        }

        if storedToken.isEmpty,
           let legacyToken = defaults.string(forKey: Keys.token),
           !legacyToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            do {
                try tokenStore.writeToken(legacyToken)
                storedToken = legacyToken
                storageError = nil
                defaults.removeObject(forKey: Keys.token)
            } catch {
                storageError = Self.credentialStorageErrorMessage
            }
        } else {
            // Do not leave a legacy secret behind when a Keychain value already exists.
            defaults.removeObject(forKey: Keys.token)
        }

        self.bridgeURL = storedBridgeURL
        self.token = storedToken
        self.credentialStorageError = storageError
    }

    var normalizedBridgeURL: URL? {
        var raw = bridgeURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasSuffix("/") {
            raw.removeLast()
        }
        guard let url = URL(string: raw),
              ["http", "https"].contains(url.scheme?.lowercased()),
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil
        else {
            return nil
        }
        return url
    }

    @discardableResult
    func apply(configurationURL url: URL) -> Bool {
        guard url.scheme?.lowercased() == "phonedex",
              url.host?.lowercased() == "configure",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        else {
            return false
        }

        var updated = false
        if let bridgeURL = components.value(forQueryItem: "bridgeUrl") ??
            components.value(forQueryItem: "bridgeURL") ??
            components.value(forQueryItem: "bridge_url"),
            let candidate = URL(string: bridgeURL),
            candidate.user == nil,
            candidate.password == nil,
            candidate.query == nil,
            candidate.fragment == nil,
            ["http", "https"].contains(candidate.scheme?.lowercased()),
            !bridgeURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.bridgeURL = candidate.absoluteString
            updated = true
        }

        return updated
    }

    private enum Keys {
        static let bridgeURL = "phonedex.bridgeURL"
        static let token = "phonedex.token"
    }

    private static let credentialStorageErrorMessage =
        "Secure credential storage is unavailable. Try again."

    private func persistToken() {
        do {
            if token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                try tokenStore.removeToken()
            } else {
                try tokenStore.writeToken(token)
            }
            credentialStorageError = nil
        } catch {
            credentialStorageError = Self.credentialStorageErrorMessage
        }
    }
}

private extension URLComponents {
    func value(forQueryItem name: String) -> String? {
        queryItems?.first { $0.name == name }?.value
    }
}
