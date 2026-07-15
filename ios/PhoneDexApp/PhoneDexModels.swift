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

    var displayWorkspace: String {
        guard let cwd, !cwd.isEmpty else { return "Unknown workspace" }
        return URL(fileURLWithPath: cwd).lastPathComponent
    }

    var displayMachine: String {
        guard let machineName, !machineName.isEmpty else { return "Unknown device" }
        return machineName
    }

    var displayDate: Date? {
        guard let at else { return nil }
        return ISO8601DateFormatter.phoneDex.date(from: at)
    }

    var projectID: String {
        "\(machineName ?? "")\u{1F}\(cwd ?? "")"
    }
}

struct PhoneDexProject: Identifiable, Equatable {
    let id: String
    let name: String
    let path: String?
    let machineName: String
    let tasks: [PhoneDexTask]

    init(tasks: [PhoneDexTask]) {
        let first = tasks[0]
        id = first.projectID
        name = first.displayWorkspace
        path = first.cwd
        machineName = first.displayMachine
        self.tasks = tasks.sorted {
            ($0.displayDate ?? .distantPast) > ($1.displayDate ?? .distantPast)
        }
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
