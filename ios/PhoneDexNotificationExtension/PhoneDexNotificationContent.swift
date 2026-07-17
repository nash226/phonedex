import Foundation

struct PhoneDexNotificationContent: Equatable {
    static let maxAppLength = 80
    static let maxTitleLength = 180
    static let maxBodyLength = 12_000

    let app: String
    let title: String
    let body: String

    init(app: String = "PhoneDex", title: String?, body: String?) {
        self.app = Self.normalized(app, fallback: "PhoneDex", limit: Self.maxAppLength)
        self.title = Self.normalized(title, fallback: "Codex update", limit: Self.maxTitleLength)
        self.body = Self.normalized(body, fallback: "No notification body was provided.", limit: Self.maxBodyLength)
    }

    private static func normalized(_ value: String?, fallback: String, limit: Int) -> String {
        let candidate = (value ?? "")
            .filter { !$0.isNewline || $0 == "\n" }
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty else { return fallback }
        guard candidate.count > limit else { return candidate }
        return String(candidate.prefix(limit - 1)).trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }
}
