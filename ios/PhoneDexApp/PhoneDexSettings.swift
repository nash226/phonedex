import Foundation

@MainActor
final class PhoneDexSettings: ObservableObject {
    @Published var bridgeURL: String {
        didSet { defaults.set(bridgeURL, forKey: Keys.bridgeURL) }
    }

    @Published var token: String {
        didSet { defaults.set(token, forKey: Keys.token) }
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.bridgeURL = defaults.string(forKey: Keys.bridgeURL) ?? "http://127.0.0.1:8765"
        self.token = defaults.string(forKey: Keys.token) ?? ""
    }

    var normalizedBridgeURL: URL? {
        var raw = bridgeURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasSuffix("/") {
            raw.removeLast()
        }
        return URL(string: raw)
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
            !bridgeURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.bridgeURL = bridgeURL
            updated = true
        }

        if let token = components.value(forQueryItem: "token"),
           !token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            self.token = token
            updated = true
        }

        return updated
    }

    private enum Keys {
        static let bridgeURL = "phonedex.bridgeURL"
        static let token = "phonedex.token"
    }
}

private extension URLComponents {
    func value(forQueryItem name: String) -> String? {
        queryItems?.first { $0.name == name }?.value
    }
}
