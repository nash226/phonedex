import Foundation

struct PhoneDexTask: Decodable, Identifiable, Equatable {
    let id: String
    let at: String?
    let source: String?
    let title: String
    let text: String
    let cwd: String?
    let machineName: String?
    let sessionId: String?
    let status: String?
    let branch: String?
    let repository: String?

    var displayWorkspace: String {
        guard let cwd, !cwd.isEmpty else { return "Unknown workspace" }
        return URL(fileURLWithPath: cwd).lastPathComponent
    }

    var displayMachine: String {
        guard let machineName, !machineName.isEmpty else { return "Unknown device" }
        return machineName
    }

    var displayStatus: String {
        switch status {
        case "needs_input": return "Needs your input"
        case "awaiting_approval": return "Needs approval"
        case "needs_review": return "Needs review"
        case "queued": return "Queued"
        case "running": return "Running"
        case "failed": return "Failed"
        case "cancelled": return "Cancelled"
        case "completed": return "Completed"
        default: return "Recent"
        }
    }

    var statusSymbol: String {
        switch status {
        case "needs_input": return "questionmark.circle.fill"
        case "awaiting_approval": return "checkmark.shield.fill"
        case "needs_review": return "doc.text.magnifyingglass"
        case "queued": return "clock.fill"
        case "running": return "arrow.triangle.2.circlepath"
        case "failed": return "exclamationmark.triangle.fill"
        case "cancelled": return "xmark.circle.fill"
        case "completed": return "checkmark.circle.fill"
        default: return "bubble.left.fill"
        }
    }

    var displayDate: Date? {
        guard let at else { return nil }
        return ISO8601DateFormatter.phoneDex.date(from: at)
    }
}

enum PhoneDexChatScope: String, CaseIterable, Identifiable {
    case needsYou
    case running
    case recent

    var id: String { rawValue }

    var title: String {
        switch self {
        case .needsYou: return "Needs You"
        case .running: return "Running"
        case .recent: return "Recent"
        }
    }

    var emptyTitle: String {
        switch self {
        case .needsYou: return "Nothing needs you"
        case .running: return "Nothing is running"
        case .recent: return "No recent conversations"
        }
    }

    var emptyDescription: String {
        switch self {
        case .needsYou: return "Questions, approvals, reviews, and failures will appear here."
        case .running: return "Active Codex work will appear here as it progresses."
        case .recent: return "Completed and earlier Codex work will appear here."
        }
    }
}

struct PhoneDexTaskFilter: Equatable {
    var scope: PhoneDexChatScope = .needsYou
    var searchText = ""
    var machineName: String?
    var workspaceName: String?

    var hasFilters: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            machineName != nil || workspaceName != nil
    }

    func filteredTasks(_ tasks: [PhoneDexTask]) -> [PhoneDexTask] {
        tasks.filter { task in
            scopeMatches(task) &&
                (machineName == nil || task.displayMachine == machineName) &&
                (workspaceName == nil || task.displayWorkspace == workspaceName) &&
                searchMatches(task)
        }
    }

    func machineOptions(from tasks: [PhoneDexTask]) -> [String] {
        Set(tasks.map(\.displayMachine)).sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
    }

    func workspaceOptions(from tasks: [PhoneDexTask]) -> [String] {
        Set(tasks.map(\.displayWorkspace)).sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
    }

    private func scopeMatches(_ task: PhoneDexTask) -> Bool {
        switch scope {
        case .needsYou:
            return ["needs_input", "awaiting_approval", "needs_review", "failed"].contains(task.status ?? "")
        case .running:
            return ["queued", "running"].contains(task.status ?? "")
        case .recent:
            return !["needs_input", "awaiting_approval", "needs_review", "failed", "queued", "running"].contains(task.status ?? "")
        }
    }

    private func searchMatches(_ task: PhoneDexTask) -> Bool {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return true }
        return [
            task.title,
            task.text,
            task.displayWorkspace,
            task.displayMachine,
            task.source ?? "",
            task.branch ?? "",
            task.repository ?? ""
        ].contains { $0.localizedCaseInsensitiveContains(query) }
    }
}

struct PhoneDexDevice: Decodable, Identifiable, Equatable {
    let deviceId: String
    let machineName: String?
    let platform: String?
    let role: String?
    let status: String?
    let lastSeenAt: String?
    let version: String?
    let publicUrl: String?
    let expected: Bool?

    var id: String { deviceId }

    var displayName: String {
        guard let machineName, !machineName.isEmpty else { return deviceId }
        return machineName
    }

    var isOnline: Bool { status == "online" }
}

enum PhoneDexReplyChoice: String {
    case okayWhatsNext = "okay_whats_next"
    case letsDoThat = "lets_do_that"
    case custom

    var prompt: String {
        switch self {
        case .okayWhatsNext:
            return "okay whats next"
        case .letsDoThat:
            return "lets do that"
        case .custom:
            return ""
        }
    }
}

struct PhoneDexReplyResponse: Decodable {
    let ok: Bool
    let duplicate: Bool?
}

extension ISO8601DateFormatter {
    fileprivate static let phoneDex: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
