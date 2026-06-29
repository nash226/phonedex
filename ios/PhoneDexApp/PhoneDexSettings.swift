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

    private enum Keys {
        static let bridgeURL = "phonedex.bridgeURL"
        static let token = "phonedex.token"
    }
}
