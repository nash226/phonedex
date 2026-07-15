import Foundation

struct PhoneDexTask: Codable, Identifiable, Equatable {
    let id: String
    let at: String?
    let createdAt: String?
    let updatedAt: String?
    let version: Int?
    let source: String?
    let title: String
    let text: String
    let cwd: String?
    let workspaceName: String?
    let machineName: String?
    let sessionId: String?
    let status: String?
    let branch: String?
    let repository: String?
    let captureSources: [PhoneDexCaptureSource]

    private enum CodingKeys: String, CodingKey {
        case id, at, createdAt, updatedAt, version, source, title, text, cwd, workspaceName
        case machineName, sessionId, status, branch, repository, captureSources
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        at = try container.decodeIfPresent(String.self, forKey: .at)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        version = try container.decodeIfPresent(Int.self, forKey: .version)
        source = try container.decodeIfPresent(String.self, forKey: .source)
        title = try container.decodeIfPresent(String.self, forKey: .title) ?? "Codex task"
        text = try container.decodeIfPresent(String.self, forKey: .text) ?? ""
        cwd = try container.decodeIfPresent(String.self, forKey: .cwd)
        workspaceName = try container.decodeIfPresent(String.self, forKey: .workspaceName)
        machineName = try container.decodeIfPresent(String.self, forKey: .machineName)
        sessionId = try container.decodeIfPresent(String.self, forKey: .sessionId)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        branch = try container.decodeIfPresent(String.self, forKey: .branch)
        repository = try container.decodeIfPresent(String.self, forKey: .repository)
        captureSources = try container.decodeIfPresent([PhoneDexCaptureSource].self, forKey: .captureSources) ?? []
    }

    init(
        id: String,
        at: String?,
        source: String?,
        title: String,
        text: String,
        cwd: String?,
        workspaceName: String?,
        machineName: String?,
        sessionId: String?,
        status: String?,
        branch: String?,
        repository: String?,
        createdAt: String? = nil,
        updatedAt: String? = nil,
        version: Int? = nil,
        captureSources: [PhoneDexCaptureSource] = []
    ) {
        self.id = id
        self.at = at
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.version = version
        self.source = source
        self.title = title
        self.text = text
        self.cwd = cwd
        self.workspaceName = workspaceName
        self.machineName = machineName
        self.sessionId = sessionId
        self.status = status
        self.branch = branch
        self.repository = repository
        self.captureSources = captureSources
    }

    var displayWorkspace: String {
        if let workspaceName, !workspaceName.isEmpty { return workspaceName }
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
        date(from: at ?? createdAt)
    }

    var lastUpdatedDate: Date? {
        date(from: updatedAt) ?? displayDate
    }

    var activity: [PhoneDexTaskActivity] {
        var items = [PhoneDexTaskActivity]()
        if let date = displayDate {
            items.append(PhoneDexTaskActivity(
                id: "created",
                title: "Task recorded",
                detail: "PhoneDex received this task from " + displaySource,
                symbol: "arrow.down.circle",
                date: date
            ))
        }
        for (index, capture) in captureSources.enumerated() {
            guard let captureDate = capture.displayDate ?? displayDate else { continue }
            items.append(PhoneDexTaskActivity(
                id: "capture-\(index)-\(capture.id)",
                title: capture.displayName,
                detail: capture.messageId.map { "Message \($0)" },
                symbol: "arrow.triangle.merge",
                date: captureDate
            ))
        }
        if let date = lastUpdatedDate, date != displayDate {
            items.append(PhoneDexTaskActivity(
                id: "updated",
                title: displayStatus,
                detail: "Latest known task state",
                symbol: statusSymbol,
                date: date
            ))
        }
        return items.sorted { $0.date < $1.date }
    }

    var displaySource: String {
        switch source {
        case "stop-hook": return "Stop hook"
        case "session-watcher": return "session watcher"
        case "remote-agent": return "remote agent"
        default: return source?.replacingOccurrences(of: "-", with: " ") ?? "bridge"
        }
    }

    private func date(from value: String?) -> Date? {
        guard let value else { return nil }
        return ISO8601DateFormatter.phoneDex.date(from: value)
    }

    var projectID: String {
        "\(machineName ?? "")\u{1F}\(cwd ?? "")"
    }

    var conversationID: String {
        let thread = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return "\(machineName ?? "")\u{1F}\(thread.isEmpty ? id : thread)"
    }

    static func latestPerConversation(_ tasks: [PhoneDexTask]) -> [PhoneDexTask] {
        var latest: [String: PhoneDexTask] = [:]
        for task in tasks {
            guard let current = latest[task.conversationID] else {
                latest[task.conversationID] = task
                continue
            }
            if (task.displayDate ?? .distantPast) > (current.displayDate ?? .distantPast) {
                latest[task.conversationID] = task
            }
        }
        return Array(latest.values)
    }
}

struct PhoneDexCaptureSource: Codable, Equatable, Identifiable {
    let source: String
    let messageId: String?
    let observedAt: String?

    var id: String { "\(source)-\(messageId ?? "unknown")" }
    var displayDate: Date? {
        guard let observedAt else { return nil }
        return ISO8601DateFormatter.phoneDex.date(from: observedAt)
    }
    var displayName: String {
        switch source {
        case "stop-hook": return "Captured by Stop hook"
        case "session-watcher": return "Captured by session watcher"
        default: return "Captured by \(source.replacingOccurrences(of: "-", with: " "))"
        }
    }
}

struct PhoneDexTaskActivity: Equatable, Identifiable {
    let id: String
    let title: String
    let detail: String?
    let symbol: String
    let date: Date
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
        Set(tasks.map(\.displayMachine)).sorted(by: stableLocalizedOrder)
    }

    func workspaceOptions(from tasks: [PhoneDexTask]) -> [String] {
        Set(tasks.map(\.displayWorkspace)).sorted(by: stableLocalizedOrder)
    }

    private func stableLocalizedOrder(_ lhs: String, _ rhs: String) -> Bool {
        let order = lhs.localizedCaseInsensitiveCompare(rhs)
        return order == .orderedSame ? lhs < rhs : order == .orderedAscending
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

    private func stableOptionOrder(_ lhs: String, _ rhs: String) -> Bool {
        switch lhs.localizedCaseInsensitiveCompare(rhs) {
        case .orderedAscending:
            return true
        case .orderedDescending:
            return false
        case .orderedSame:
            return lhs < rhs
        }
    }
}

struct PhoneDexDevice: Codable, Identifiable, Equatable {
    let deviceId: String
    let machineName: String?
    let platform: String?
    let role: String?
    let status: String?
    let lastSeenAt: String?
    let version: String?
    let publicUrl: String?
    let expected: Bool?
    let capabilities: [String]
    let componentHealth: PhoneDexDeviceHealthSummary?
    let capabilityDetails: [PhoneDexCapability]

    private enum CodingKeys: String, CodingKey {
        case deviceId, machineName, platform, role, status, lastSeenAt, version, agentVersion, publicUrl, expected, capabilities
        case componentHealth = "health"
        case capabilityDetails
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        deviceId = try container.decode(String.self, forKey: .deviceId)
        machineName = try container.decodeIfPresent(String.self, forKey: .machineName)
        platform = try container.decodeIfPresent(String.self, forKey: .platform)
        role = try container.decodeIfPresent(String.self, forKey: .role)
        status = try container.decodeIfPresent(String.self, forKey: .status)
        lastSeenAt = try container.decodeIfPresent(String.self, forKey: .lastSeenAt)
        version = try container.decodeIfPresent(String.self, forKey: .version) ??
            container.decodeIfPresent(String.self, forKey: .agentVersion)
        publicUrl = try container.decodeIfPresent(String.self, forKey: .publicUrl)
        expected = try container.decodeIfPresent(Bool.self, forKey: .expected)
        capabilities = try container.decodeIfPresent([String].self, forKey: .capabilities) ?? []
        componentHealth = try container.decodeIfPresent(PhoneDexDeviceHealthSummary.self, forKey: .componentHealth)
        let details = try container.decodeIfPresent([PhoneDexCapability].self, forKey: .capabilityDetails) ?? []
        capabilityDetails = details.isEmpty
            ? capabilities.compactMap(PhoneDexCapability.init(legacyFlag:))
            : details
    }

    init(
        deviceId: String,
        machineName: String?,
        platform: String?,
        role: String?,
        status: String?,
        lastSeenAt: String?,
        version: String?,
        publicUrl: String?,
        expected: Bool?,
        capabilities: [String] = [],
        componentHealth: PhoneDexDeviceHealthSummary? = nil,
        capabilityDetails: [PhoneDexCapability] = []
    ) {
        self.deviceId = deviceId
        self.machineName = machineName
        self.platform = platform
        self.role = role
        self.status = status
        self.lastSeenAt = lastSeenAt
        self.version = version
        self.publicUrl = publicUrl
        self.expected = expected
        self.capabilities = capabilities
        self.componentHealth = componentHealth
        self.capabilityDetails = capabilityDetails
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(deviceId, forKey: .deviceId)
        try container.encodeIfPresent(machineName, forKey: .machineName)
        try container.encodeIfPresent(platform, forKey: .platform)
        try container.encodeIfPresent(role, forKey: .role)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(lastSeenAt, forKey: .lastSeenAt)
        try container.encodeIfPresent(version, forKey: .version)
        try container.encodeIfPresent(publicUrl, forKey: .publicUrl)
        try container.encodeIfPresent(expected, forKey: .expected)
        try container.encode(capabilities, forKey: .capabilities)
        try container.encodeIfPresent(componentHealth, forKey: .componentHealth)
        try container.encode(capabilityDetails, forKey: .capabilityDetails)
    }

    var id: String { deviceId }

    var displayName: String {
        guard let machineName, !machineName.isEmpty else { return deviceId }
        return machineName
    }

    var isOnline: Bool { status == "online" }
}

struct PhoneDexDeviceHealthSummary: Codable, Equatable {
    let reachability: String?
    let agent: String?
    let adapter: String?
}

struct PhoneDexCapability: Codable, Identifiable, Equatable {
    let capabilityId: String
    let version: String
    let scope: String
    let supported: Bool

    private enum CodingKeys: String, CodingKey {
        case capabilityId = "id"
        case version, scope, supported
    }

    init(capabilityId: String, version: String, scope: String, supported: Bool) {
        self.capabilityId = capabilityId
        self.version = version
        self.scope = scope
        self.supported = supported
    }

    init?(legacyFlag: String) {
        let parts = legacyFlag.split(separator: ".")
        guard parts.count >= 2, let version = parts.last, version.first == "v" else { return nil }
        let capabilityId = parts.dropLast().joined(separator: ".")
        guard !capabilityId.isEmpty else { return nil }
        self.init(
            capabilityId: capabilityId,
            version: String(version.dropFirst()),
            scope: capabilityId == "task.reply" ? "task" : "device",
            supported: true
        )
    }

    var identity: String { "\(capabilityId).v\(version)" }
    var displayName: String {
        capabilityId.split(separator: ".")
            .map { $0.replacingOccurrences(of: "_", with: " ").capitalized }
            .joined(separator: " ")
    }
    var scopeTitle: String { scope.capitalized }

    var isActionable: Bool { !supported }
    var symbol: String { supported ? "checkmark.circle.fill" : "minus.circle" }

    var id: String { identity }
}

struct PhoneDexProtocolNegotiation: Decodable, Equatable {
    let negotiatedVersion: Int
    let supportedVersions: [Int]
    let capabilities: [PhoneDexCapability]

    var isCurrent: Bool {
        negotiatedVersion == 1 && supportedVersions.contains(1)
    }
}

struct PhoneDexSyncPage: Decodable {
    let protocolNegotiation: PhoneDexProtocolNegotiation?
    let snapshot: PhoneDexSyncSnapshot?
    let changes: [PhoneDexSyncChange]
    let cursor: String
    let hasMore: Bool

    private enum CodingKeys: String, CodingKey {
        case protocolNegotiation = "protocol"
        case snapshot, changes, cursor, hasMore
    }
}

struct PhoneDexSyncSnapshot: Decodable {
    let tasks: [PhoneDexTask]
    let devices: [PhoneDexDevice]
}

struct PhoneDexSyncChange: Decodable {
    let position: Int
    let kind: String
    let id: String
    let deleted: Bool
    let task: PhoneDexTask?
    let device: PhoneDexDevice?

    private enum CodingKeys: String, CodingKey {
        case position, kind, id, deleted, record
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        position = try container.decode(Int.self, forKey: .position)
        kind = try container.decode(String.self, forKey: .kind)
        id = try container.decode(String.self, forKey: .id)
        deleted = try container.decode(Bool.self, forKey: .deleted)

        guard !deleted else {
            task = nil
            device = nil
            return
        }

        switch kind {
        case "task":
            task = try container.decode(PhoneDexTask.self, forKey: .record)
            device = nil
        case "device":
            task = nil
            device = try container.decode(PhoneDexDevice.self, forKey: .record)
        default:
            task = nil
            device = nil
        }
    }
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
