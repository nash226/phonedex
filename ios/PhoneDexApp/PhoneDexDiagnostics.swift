import Foundation

enum PhoneDexDeviceHealth: Equatable {
    case online
    case stale
    case missing
    case revoked
    case unknown

    init(status: String?) {
        switch status?.lowercased() {
        case "online": self = .online
        case "stale": self = .stale
        case "missing": self = .missing
        case "revoked": self = .revoked
        default: self = .unknown
        }
    }

    var title: String {
        switch self {
        case .online: return "Online"
        case .stale: return "Stale"
        case .missing: return "Unavailable"
        case .revoked: return "Revoked"
        case .unknown: return "Needs review"
        }
    }

    var symbol: String {
        switch self {
        case .online: return "checkmark.circle.fill"
        case .stale: return "clock.badge.exclamationmark.fill"
        case .missing: return "wifi.exclamationmark"
        case .revoked: return "lock.slash.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }

    var isActionable: Bool { self != .online }
}

struct PhoneDexDeviceDiagnostic: Equatable {
    let title: String
    let message: String
    let nextStep: String
}

extension PhoneDexDevice {
    var health: PhoneDexDeviceHealth { PhoneDexDeviceHealth(status: status) }

    var isMacPlatform: Bool {
        ["macos", "darwin"].contains(platform?.lowercased() ?? "")
    }

    var lastSeenDate: Date? {
        guard let lastSeenAt else { return nil }
        return ISO8601DateFormatter.phoneDexDate(from: lastSeenAt)
    }

    var diagnostic: PhoneDexDeviceDiagnostic {
        switch health {
        case .online:
            return PhoneDexDeviceDiagnostic(
                title: "This computer is reachable",
                message: "PhoneDex received a recent heartbeat from this computer.",
                nextStep: "No action is needed."
            )
        case .stale:
            return PhoneDexDeviceDiagnostic(
                title: "The heartbeat is getting old",
                message: "The computer may be asleep, disconnected, or its agent may need attention.",
                nextStep: "Wake the computer and check the PhoneDex agent."
            )
        case .missing:
            return PhoneDexDeviceDiagnostic(
                title: "The computer is unavailable",
                message: "The hub does not have a recent heartbeat from this computer.",
                nextStep: "Check that the computer is on and connected to the hub network."
            )
        case .revoked:
            return PhoneDexDeviceDiagnostic(
                title: "Access has been revoked",
                message: "This computer is no longer trusted by the PhoneDex hub.",
                nextStep: "Re-pair the computer from the hub before relying on it."
            )
        case .unknown:
            return PhoneDexDeviceDiagnostic(
                title: "The device state is unknown",
                message: "The hub returned a state PhoneDex cannot identify yet.",
                nextStep: "Refresh, then check the hub and agent versions if this persists."
            )
        }
    }
}

extension PhoneDexProject {
    var latestTask: PhoneDexTask? {
        tasks.max { ($0.displayDate ?? .distantPast) < ($1.displayDate ?? .distantPast) }
    }

    var activeTaskCount: Int {
        tasks.filter { ["queued", "running"].contains($0.status ?? "") }.count
    }

    var attentionTaskCount: Int {
        tasks.filter {
            ["needs_input", "awaiting_approval", "needs_review", "failed"].contains($0.status ?? "")
        }.count
    }
}

extension ISO8601DateFormatter {
    fileprivate static func phoneDexDate(from value: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }

        let wholeSeconds = ISO8601DateFormatter()
        wholeSeconds.formatOptions = [.withInternetDateTime]
        return wholeSeconds.date(from: value)
    }
}
