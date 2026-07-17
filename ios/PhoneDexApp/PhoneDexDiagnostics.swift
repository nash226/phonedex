import Foundation

struct PhoneDexDiagnosticsSnapshot: Codable, Equatable {
    struct RouteMetric: Codable, Equatable {
        let requests: Int
        let failures: Int
        let averageLatencyMs: Int
    }

    struct Request: Codable, Equatable, Identifiable {
        let at: String
        let correlationId: String
        let route: String
        let status: Int
        let latencyMs: Int
        let errorClass: String?

        var id: String { "\(at)-\(correlationId)" }
    }

    struct Capability: Codable, Equatable, Identifiable {
        let id: String
        let supported: Bool
    }

    struct Metrics: Codable, Equatable {
        let requests: Int
        let failures: Int
        let commands: Int
        let routes: [String: RouteMetric]
    }

    let schema: String
    let generatedAt: String
    let startedAt: String
    let service: String
    let role: String
    let version: String
    let protocolVersion: Int
    let components: [String: String]
    let metrics: Metrics
    let recentRequests: [Request]
    let capabilities: [Capability]

    var shareText: String {
        let componentSummary = components.keys.sorted().map { key in
            let state = components[key] ?? "unknown"
            return "\(key)=\(state)"
        }.joined(separator: ", ")
        let capabilitySummary = capabilities.sorted { $0.id < $1.id }.map { capability in
            let state = capability.supported ? "available" : "unavailable"
            return "\(capability.id)=\(state)"
        }.joined(separator: ", ")
        let capabilitiesText = capabilitySummary.isEmpty ? "none reported" : capabilitySummary
        return [
            "PhoneDex diagnostics",
            "Generated: \(generatedAt)",
            "Service: \(service) (\(role)) \(version)",
            "Protocol: v\(protocolVersion)",
            "Components: \(componentSummary)",
            "Requests: \(metrics.requests); failures: \(metrics.failures); commands: \(metrics.commands)",
            "Capabilities: \(capabilitiesText)"
        ].joined(separator: "\n")
    }
}

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

enum PhoneDexComponentHealth: Equatable {
    case healthy
    case degraded
    case unhealthy
    case unknown

    init(status: String?) {
        switch status?.lowercased() {
        case "healthy": self = .healthy
        case "degraded": self = .degraded
        case "unhealthy": self = .unhealthy
        default: self = .unknown
        }
    }

    var title: String {
        switch self {
        case .healthy: return "Healthy"
        case .degraded: return "Degraded"
        case .unhealthy: return "Unhealthy"
        case .unknown: return "Unknown"
        }
    }

    var symbol: String {
        switch self {
        case .healthy: return "checkmark.circle.fill"
        case .degraded: return "exclamationmark.circle.fill"
        case .unhealthy: return "xmark.octagon.fill"
        case .unknown: return "questionmark.circle.fill"
        }
    }

    var isActionable: Bool { self != .healthy }
}

struct PhoneDexDeviceDiagnostic: Equatable {
    let title: String
    let message: String
    let nextStep: String
}

extension PhoneDexDevice {
    var health: PhoneDexDeviceHealth { PhoneDexDeviceHealth(status: status) }

    var reachabilityHealth: PhoneDexDeviceHealth {
        PhoneDexDeviceHealth(status: componentHealth?.reachability ?? status)
    }

    var agentHealth: PhoneDexComponentHealth {
        PhoneDexComponentHealth(status: componentHealth?.agent)
    }

    var adapterHealth: PhoneDexComponentHealth {
        PhoneDexComponentHealth(status: componentHealth?.adapter)
    }

    var isMacPlatform: Bool {
        ["macos", "darwin"].contains(platform?.lowercased() ?? "")
    }

    var lastSeenDate: Date? {
        guard let lastSeenAt else { return nil }
        return ISO8601DateFormatter.phoneDexDate(from: lastSeenAt)
    }

    var diagnostic: PhoneDexDeviceDiagnostic {
        switch reachabilityHealth {
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
