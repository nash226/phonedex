import Foundation

struct PhoneDexReleaseIdentity: Equatable {
    let version: String
    let build: String

    var displayValue: String {
        build.isEmpty ? version : "\(version) (\(build))"
    }

    init(version: String?, build: String?) {
        let normalizedVersion = version?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let normalizedBuild = build?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        self.version = normalizedVersion.isEmpty ? "Development" : normalizedVersion
        self.build = normalizedBuild
    }

    init(bundle: Bundle) {
        self.init(
            version: bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String,
            build: bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        )
    }
}

@MainActor
final class PhoneDexSettings: ObservableObject {
    @Published var bridgeURL: String {
        didSet { defaults.set(bridgeURL, forKey: Keys.bridgeURL) }
    }

    @Published var token: String {
        didSet {
            guard !suppressTokenPersistence else { return }
            persistToken()
        }
    }

    @Published var requireApprovalAuthentication: Bool {
        didSet { defaults.set(requireApprovalAuthentication, forKey: Keys.requireApprovalAuthentication) }
    }

    @Published var notificationPrivacy: PhoneDexNotificationPrivacy {
        didSet { defaults.set(notificationPrivacy.rawValue, forKey: Keys.notificationPrivacy) }
    }

    private let defaults: UserDefaults
    private let tokenStore: any PhoneDexTokenStoring
    private var suppressTokenPersistence = false

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
        self.requireApprovalAuthentication = defaults.object(forKey: Keys.requireApprovalAuthentication) as? Bool ?? true
        self.notificationPrivacy = PhoneDexNotificationPrivacy(
            rawValue: defaults.string(forKey: Keys.notificationPrivacy) ?? ""
        ) ?? .safeSummary
        self.credentialStorageError = storageError
    }

    var normalizedBridgeURL: URL? {
        var raw = bridgeURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasSuffix("/") {
            raw.removeLast()
        }
        guard let url = URL(string: raw),
              Self.isSupportedBridgeURL(url),
              url.user == nil,
              url.password == nil,
              url.query == nil,
              url.fragment == nil
        else {
            return nil
        }
        return url
    }

    var bridgeURLValidationMessage: String {
        normalizedBridgeURL == nil
            ? "Use an HTTPS bridge URL. HTTP is available only for localhost development."
            : ""
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
            Self.isSupportedBridgeURL(candidate),
            !bridgeURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.bridgeURL = candidate.absoluteString
            updated = true
        }

        return updated
    }

    /// Removes the locally stored bridge credential only after Keychain removal succeeds.
    /// The hub credential is not revoked by this local action; pairing can be repeated later.
    @discardableResult
    func forgetCredential() -> Bool {
        do {
            try tokenStore.removeToken()
            suppressTokenPersistence = true
            token = ""
            suppressTokenPersistence = false
            credentialStorageError = nil
            return true
        } catch {
            credentialStorageError = Self.credentialStorageErrorMessage
            return false
        }
    }

    private enum Keys {
        static let bridgeURL = "phonedex.bridgeURL"
        static let token = "phonedex.token"
        static let requireApprovalAuthentication = "phonedex.requireApprovalAuthentication"
        static let notificationPrivacy = "phonedex.notificationPrivacy"
    }

    private static let credentialStorageErrorMessage =
        "Secure credential storage is unavailable. Try again."

    private static func isSupportedBridgeURL(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased() else { return false }
        if scheme == "https" { return true }
        guard scheme == "http", let host = url.host?.lowercased() else { return false }
        return ["localhost", "127.0.0.1", "::1"].contains(host)
    }

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
