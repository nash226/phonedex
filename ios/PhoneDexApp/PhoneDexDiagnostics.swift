import Foundation

struct PhoneDexDiagnosticsSnapshot: Codable, Equatable {
    static let maxComponents = 32
    static let maxRouteMetrics = 64
    static let maxRecentRequests = 50
    static let maxCapabilities = 64
    static let maxSchemaLength = 80
    static let maxTimestampLength = 64
    static let maxServiceLength = 80
    static let maxRoleLength = 80
    static let maxVersionLength = 80
    static let maxComponentKeyLength = 80
    static let maxComponentStateLength = 40
    static let maxRouteLength = 120
    static let maxCorrelationIDLength = 160
    static let maxErrorClassLength = 160
    static let maxCapabilityIDLength = 120
    static let maxMetricValue = 1_000_000_000

    struct RouteMetric: Codable, Equatable {
        let requests: Int
        let failures: Int
        let averageLatencyMs: Int

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            requests = try Self.decodeMetric(.requests, from: container, decoder: decoder)
            failures = try Self.decodeMetric(.failures, from: container, decoder: decoder)
            averageLatencyMs = try Self.decodeMetric(.averageLatencyMs, from: container, decoder: decoder)
        }

        private enum CodingKeys: String, CodingKey {
            case requests, failures, averageLatencyMs
        }

        private static func decodeMetric(
            _ key: CodingKeys,
            from container: KeyedDecodingContainer<CodingKeys>,
            decoder: Decoder
        ) throws -> Int {
            let value = try container.decode(Int.self, forKey: key)
            guard (0...PhoneDexDiagnosticsSnapshot.maxMetricValue).contains(value) else {
                throw DecodingError.dataCorrupted(.init(
                    codingPath: decoder.codingPath,
                    debugDescription: "Diagnostics metric \(key.stringValue) is outside its supported range."
                ))
            }
            return value
        }
    }

    struct Request: Codable, Equatable, Identifiable {
        let at: String
        let correlationId: String
        let route: String
        let status: Int
        let latencyMs: Int
        let errorClass: String?

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            at = try Self.decodeString(.at, from: container, decoder: decoder, maxLength: PhoneDexDiagnosticsSnapshot.maxTimestampLength)
            correlationId = try Self.decodeString(.correlationId, from: container, decoder: decoder, maxLength: PhoneDexDiagnosticsSnapshot.maxCorrelationIDLength)
            route = try Self.decodeString(.route, from: container, decoder: decoder, maxLength: PhoneDexDiagnosticsSnapshot.maxRouteLength)
            status = try Self.decodeMetric(.status, from: container, decoder: decoder)
            latencyMs = try Self.decodeMetric(.latencyMs, from: container, decoder: decoder)
            errorClass = try Self.decodeOptionalString(.errorClass, from: container, decoder: decoder, maxLength: PhoneDexDiagnosticsSnapshot.maxErrorClassLength)
        }

        private enum CodingKeys: String, CodingKey {
            case at, correlationId, route, status, latencyMs, errorClass
        }

        private static func decodeString(
            _ key: CodingKeys,
            from container: KeyedDecodingContainer<CodingKeys>,
            decoder: Decoder,
            maxLength: Int
        ) throws -> String {
            let value = try container.decode(String.self, forKey: key)
            guard value.count <= maxLength else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostics field \(key.stringValue) exceeds its native display limit."))
            }
            return value
        }

        private static func decodeOptionalString(
            _ key: CodingKeys,
            from container: KeyedDecodingContainer<CodingKeys>,
            decoder: Decoder,
            maxLength: Int
        ) throws -> String? {
            guard let value = try container.decodeIfPresent(String.self, forKey: key) else { return nil }
            guard value.count <= maxLength else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostics field \(key.stringValue) exceeds its native display limit."))
            }
            return value
        }

        private static func decodeMetric(
            _ key: CodingKeys,
            from container: KeyedDecodingContainer<CodingKeys>,
            decoder: Decoder
        ) throws -> Int {
            let value = try container.decode(Int.self, forKey: key)
            guard (0...PhoneDexDiagnosticsSnapshot.maxMetricValue).contains(value) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostics metric \(key.stringValue) is outside its supported range."))
            }
            return value
        }

        var id: String { "\(at)-\(correlationId)" }

        var routeLabel: String {
            let path = route.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: true).first.map(String.init) ?? ""
            guard !path.isEmpty, path.utf8.count <= 64, !path.contains(where: { $0.isWhitespace }) else {
                return "Unknown endpoint"
            }
            return path
        }
    }

    struct Capability: Codable, Equatable, Identifiable {
        let id: String
        let supported: Bool

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            id = try container.decode(String.self, forKey: .id)
            guard id.count <= PhoneDexDiagnosticsSnapshot.maxCapabilityIDLength else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostic capability id exceeds its native display limit."))
            }
            supported = try container.decode(Bool.self, forKey: .supported)
        }

        private enum CodingKeys: String, CodingKey { case id, supported }
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

    private enum CodingKeys: String, CodingKey {
        case schema, generatedAt, startedAt, service, role, version, protocolVersion
        case components, metrics, recentRequests, capabilities
    }

    private struct AnyCodingKey: CodingKey {
        let stringValue: String
        let intValue: Int?

        init?(stringValue: String) {
            self.stringValue = stringValue
            intValue = nil
        }

        init?(intValue: Int) {
            stringValue = String(intValue)
            self.intValue = intValue
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schema = try Self.decodeString(.schema, from: container, decoder: decoder, maxLength: Self.maxSchemaLength)
        generatedAt = try Self.decodeString(.generatedAt, from: container, decoder: decoder, maxLength: Self.maxTimestampLength)
        startedAt = try Self.decodeString(.startedAt, from: container, decoder: decoder, maxLength: Self.maxTimestampLength)
        service = try Self.decodeString(.service, from: container, decoder: decoder, maxLength: Self.maxServiceLength)
        role = try Self.decodeString(.role, from: container, decoder: decoder, maxLength: Self.maxRoleLength)
        version = try Self.decodeString(.version, from: container, decoder: decoder, maxLength: Self.maxVersionLength)
        protocolVersion = try container.decode(Int.self, forKey: .protocolVersion)
        components = try Self.decodeBoundedMap(String.self, from: container, forKey: .components, limit: Self.maxComponents, keyLimit: Self.maxComponentKeyLength, valueLimit: Self.maxComponentStateLength, decoder: decoder)
        metrics = try Self.decodeMetrics(from: container)
        recentRequests = try Self.decodeBoundedArray(Request.self, from: container, forKey: .recentRequests, limit: Self.maxRecentRequests)
        capabilities = try Self.decodeBoundedArray(Capability.self, from: container, forKey: .capabilities, limit: Self.maxCapabilities)
    }

    private static func decodeString<Key: CodingKey>(
        _ key: Key,
        from container: KeyedDecodingContainer<Key>,
        decoder: Decoder,
        maxLength: Int
    ) throws -> String {
        let value = try container.decode(String.self, forKey: key)
        guard value.count <= maxLength else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostics field \(key.stringValue) exceeds its native display limit."))
        }
        return value
    }

    private static func decodeMetrics(from container: KeyedDecodingContainer<CodingKeys>) throws -> Metrics {
        let decoder = try container.superDecoder(forKey: .metrics)
        let metricsContainer = try decoder.container(keyedBy: MetricsCodingKeys.self)
        return Metrics(
            requests: try decodeMetric(.requests, from: metricsContainer, decoder: decoder),
            failures: try decodeMetric(.failures, from: metricsContainer, decoder: decoder),
            commands: try decodeMetric(.commands, from: metricsContainer, decoder: decoder),
            routes: try decodeBoundedMap(RouteMetric.self, from: metricsContainer, forKey: .routes, limit: Self.maxRouteMetrics, keyLimit: Self.maxRouteLength, decoder: decoder)
        )
    }

    private enum MetricsCodingKeys: String, CodingKey {
        case requests, failures, commands, routes
    }

    private static func decodeBoundedMap<Value: Decodable, Key: CodingKey>(
        _ type: Value.Type,
        from container: KeyedDecodingContainer<Key>,
        forKey key: Key,
        limit: Int,
        keyLimit: Int,
        valueLimit: Int? = nil,
        decoder: Decoder
    ) throws -> [String: Value] {
        let nested = try container.nestedContainer(keyedBy: AnyCodingKey.self, forKey: key)
        guard nested.allKeys.count <= limit else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: container,
                debugDescription: "Diagnostics collection exceeds its \(limit)-entry limit."
            )
        }

        var result = [String: Value](minimumCapacity: nested.allKeys.count)
        for entryKey in nested.allKeys {
            guard entryKey.stringValue.count <= keyLimit else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostics key exceeds its native display limit."))
            }
            let value = try nested.decode(Value.self, forKey: entryKey)
            if let valueLimit, let stringValue = value as? String, stringValue.count > valueLimit {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostics component state exceeds its native display limit."))
            }
            result[entryKey.stringValue] = value
        }
        return result
    }

    private static func decodeMetric<Key: CodingKey>(
        _ key: Key,
        from container: KeyedDecodingContainer<Key>,
        decoder: Decoder
    ) throws -> Int {
        let value = try container.decode(Int.self, forKey: key)
        guard (0...Self.maxMetricValue).contains(value) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Diagnostics metric \(key.stringValue) is outside its supported range."))
        }
        return value
    }

    private static func decodeBoundedArray<Value: Decodable, Key: CodingKey>(
        _ type: Value.Type,
        from container: KeyedDecodingContainer<Key>,
        forKey key: Key,
        limit: Int
    ) throws -> [Value] {
        var nested = try container.nestedUnkeyedContainer(forKey: key)
        guard let count = nested.count, count <= limit else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: container,
                debugDescription: "Diagnostics collection exceeds its \(limit)-entry limit."
            )
        }

        var result = [Value]()
        result.reserveCapacity(count)
        while !nested.isAtEnd {
            result.append(try nested.decode(Value.self))
        }
        return result
    }

    struct Component: Identifiable, Equatable {
        let id: String
        let health: PhoneDexComponentHealth

        var title: String {
            id.replacingOccurrences(of: "originTask", with: "Origin task")
                .replacingOccurrences(of: "push", with: "Push")
                .replacingOccurrences(of: "hub", with: "Hub")
                .replacingOccurrences(of: "agent", with: "Agent")
                .replacingOccurrences(of: "adapter", with: "Adapter")
        }
    }

    var componentRows: [Component] {
        components.keys.sorted().prefix(8).map { key in
            Component(id: key, health: PhoneDexComponentHealth(status: components[key]))
        }
    }

    var overallHealth: PhoneDexComponentHealth {
        let health = components.values.map { PhoneDexComponentHealth(status: $0) }
        if health.contains(.unhealthy) { return .unhealthy }
        if health.contains(.degraded) { return .degraded }
        if health.isEmpty || health.contains(.unknown) { return .unknown }
        return .healthy
    }

    var recentFailures: [Request] {
        recentRequests.filter { $0.status >= 400 }.suffix(5)
    }

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
