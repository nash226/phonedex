import Foundation

enum PhoneDexNativeDecodeBounds {
    static let id = 160
    static let title = 240
    static let taskText = 10_000
    static let path = 400
    static let workspaceName = 240
    static let machineName = 160
    static let source = 80
    static let status = 64
    static let branch = 240
    static let repository = 400
    static let message = 1_000
    static let questionPrompt = 2_000
    static let questionChoices = 32
    static let captureSources = 16
    static let lifecycleCapabilities = 32
    static let evidenceItems = 100
    static let patch = 600_000
    static let eventData = 32
    static let eventDataValue = 1_000
    static let syncPageItems = 100

    static func string(
        _ value: String?,
        maxLength: Int,
        key: String,
        decoder: Decoder
    ) throws -> String? {
        guard let value else { return nil }
        guard value.count <= maxLength else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "\(key) exceeds the native display limit of \(maxLength) characters"
            ))
        }
        return value
    }

    static func requiredString(
        _ value: String?,
        maxLength: Int,
        key: String,
        decoder: Decoder
    ) throws -> String {
        guard let value = try string(value, maxLength: maxLength, key: key, decoder: decoder) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "\(key) must be present"
            ))
        }
        return value
    }

    static func count(
        _ value: Int,
        max: Int,
        key: String,
        decoder: Decoder
    ) throws {
        guard value <= max else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "\(key) exceeds the native display limit of \(max) items"
            ))
        }
    }
}

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
    let deviceId: String?
    let sessionId: String?
    let status: String?
    let branch: String?
    let repository: String?
    let question: PhoneDexTaskQuestion?
    let approvalRequest: PhoneDexApprovalRequest?
    let captureSources: [PhoneDexCaptureSource]
    let evidence: PhoneDexTaskEvidence?
    let lifecycleCapabilities: [String]

    private enum CodingKeys: String, CodingKey {
        case id, at, createdAt, updatedAt, version, source, title, text, cwd, workspaceName
        case machineName, deviceId, sessionId, status, branch, repository, captureSources
        case question, approvalRequest, evidence, lifecycleCapabilities
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try PhoneDexNativeDecodeBounds.requiredString(
            try container.decode(String.self, forKey: .id),
            maxLength: PhoneDexNativeDecodeBounds.id,
            key: "task.id",
            decoder: decoder
        )
        at = try container.decodeIfPresent(String.self, forKey: .at)
        createdAt = try container.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(String.self, forKey: .updatedAt)
        version = try container.decodeIfPresent(Int.self, forKey: .version)
        source = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .source), maxLength: PhoneDexNativeDecodeBounds.source, key: "task.source", decoder: decoder)
        title = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .title), maxLength: PhoneDexNativeDecodeBounds.title, key: "task.title", decoder: decoder) ?? "Codex task"
        text = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .text), maxLength: PhoneDexNativeDecodeBounds.taskText, key: "task.text", decoder: decoder) ?? ""
        cwd = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .cwd), maxLength: PhoneDexNativeDecodeBounds.path, key: "task.cwd", decoder: decoder)
        workspaceName = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .workspaceName), maxLength: PhoneDexNativeDecodeBounds.workspaceName, key: "task.workspaceName", decoder: decoder)
        machineName = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .machineName), maxLength: PhoneDexNativeDecodeBounds.machineName, key: "task.machineName", decoder: decoder)
        deviceId = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .deviceId), maxLength: PhoneDexNativeDecodeBounds.id, key: "task.deviceId", decoder: decoder)
        sessionId = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .sessionId), maxLength: PhoneDexNativeDecodeBounds.id, key: "task.sessionId", decoder: decoder)
        status = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .status), maxLength: PhoneDexNativeDecodeBounds.status, key: "task.status", decoder: decoder)
        branch = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .branch), maxLength: PhoneDexNativeDecodeBounds.branch, key: "task.branch", decoder: decoder)
        repository = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .repository), maxLength: PhoneDexNativeDecodeBounds.repository, key: "task.repository", decoder: decoder)
        question = try container.decodeIfPresent(PhoneDexTaskQuestion.self, forKey: .question)
        approvalRequest = try container.decodeIfPresent(PhoneDexApprovalRequest.self, forKey: .approvalRequest)
        captureSources = try container.decodeIfPresent([PhoneDexCaptureSource].self, forKey: .captureSources) ?? []
        try PhoneDexNativeDecodeBounds.count(captureSources.count, max: PhoneDexNativeDecodeBounds.captureSources, key: "task.captureSources", decoder: decoder)
        evidence = try container.decodeIfPresent(PhoneDexTaskEvidence.self, forKey: .evidence)
        lifecycleCapabilities = try container.decodeIfPresent([String].self, forKey: .lifecycleCapabilities) ?? []
        try PhoneDexNativeDecodeBounds.count(lifecycleCapabilities.count, max: PhoneDexNativeDecodeBounds.lifecycleCapabilities, key: "task.lifecycleCapabilities", decoder: decoder)
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
        deviceId: String? = nil,
        createdAt: String? = nil,
        updatedAt: String? = nil,
        version: Int? = nil,
        question: PhoneDexTaskQuestion? = nil,
        approvalRequest: PhoneDexApprovalRequest? = nil,
        captureSources: [PhoneDexCaptureSource] = [],
        evidence: PhoneDexTaskEvidence? = nil,
        lifecycleCapabilities: [String] = []
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
        self.deviceId = deviceId
        self.sessionId = sessionId
        self.status = status
        self.branch = branch
        self.repository = repository
        self.question = question
        self.approvalRequest = approvalRequest
        self.captureSources = captureSources
        self.evidence = evidence
        self.lifecycleCapabilities = lifecycleCapabilities
    }

    var displayWorkspace: String {
        if let workspace = workspaceName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !workspace.isEmpty {
            return workspace
        }
        if let directory = Self.lastComponent(cwd), !directory.isEmpty {
            return directory
        }
        if let repository = Self.lastComponent(repository, removingGitSuffix: true),
           !repository.isEmpty {
            return repository
        }
        return "Unknown workspace"
    }

    var displayMachine: String {
        guard let machineName, !machineName.isEmpty else { return "Unknown device" }
        return machineName
    }

    var displayStatus: String {
        switch status {
        case "needs_input": return Self.localized("task.status.needsInput", "Needs your input", "A task is waiting for the user's answer.")
        case "awaiting_approval": return Self.localized("task.status.needsApproval", "Needs approval", "A task is waiting for an approval decision.")
        case "needs_review": return Self.localized("task.status.needsReview", "Needs review", "A task has work ready for review.")
        case "queued": return Self.localized("task.status.queued", "Queued", "A PhoneDex-managed task is queued.")
        case "running": return Self.localized("task.status.running", "Running", "A task is currently running.")
        case "failed": return Self.localized("task.status.failed", "Failed", "A task failed.")
        case "canceling": return Self.localized("task.status.cancelling", "Cancelling", "A task cancellation is in progress.")
        case "cancelled": return Self.localized("task.status.cancelled", "Cancelled", "A task was cancelled.")
        case "completed": return Self.localized("task.status.completed", "Completed", "A task completed.")
        default: return Self.localized("task.status.recent", "Recent", "A task with no current lifecycle status.")
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
        case "canceling": return "arrow.triangle.2.circlepath"
        case "cancelled": return "xmark.circle.fill"
        case "completed": return "checkmark.circle.fill"
        default: return "bubble.left.fill"
        }
    }

    var displayDate: Date? {
        date(from: at) ?? date(from: createdAt)
    }

    var lastUpdatedDate: Date? {
        date(from: updatedAt) ?? displayDate
    }

    var freshnessLabel: String {
        if date(from: updatedAt) != nil {
            return Self.localized("task.timestamp.updated", "Last updated", "The task's latest known update time.")
        }
        if displayDate != nil {
            return Self.localized("task.timestamp.recorded", "Recorded", "The time PhoneDex recorded the task.")
        }
        return Self.localized("task.timestamp.unknown", "Update time unavailable", "The task has no valid timestamp.")
    }

    var freshnessAccessibilityValue: String {
        guard let date = lastUpdatedDate else { return freshnessLabel }
        return "\(freshnessLabel), \(date.formatted(date: .abbreviated, time: .shortened))"
    }

    var activity: [PhoneDexTaskActivity] {
        var items = [PhoneDexTaskActivity]()
        if let date = displayDate {
            items.append(PhoneDexTaskActivity(
                id: "created",
                title: Self.localized("task.activity.recorded", "Task recorded", "The task was recorded by PhoneDex."),
                detail: String.localizedStringWithFormat(Self.localized("task.activity.receivedFrom", "PhoneDex received this task from %@", "The task capture source."), displaySource),
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
                detail: Self.localized("task.activity.latestState", "Latest known task state", "The most recent task state available to PhoneDex."),
                symbol: statusSymbol,
                date: date
            ))
        }
        return items.sorted { $0.date < $1.date }
    }

    var displaySource: String {
        switch source {
        case "stop-hook": return Self.localized("task.source.stopHook", "Stop hook", "The Codex stop hook capture source.")
        case "session-watcher": return Self.localized("task.source.sessionWatcher", "session watcher", "The local session watcher capture source.")
        case "remote-agent": return Self.localized("task.source.remoteAgent", "remote agent", "A remote PhoneDex agent capture source.")
        default: return source?.replacingOccurrences(of: "-", with: " ") ?? Self.localized("task.source.bridge", "bridge", "The PhoneDex bridge capture source.")
        }
    }

    private static func localized(_ key: String, _ fallback: String, _ comment: String) -> String {
        _ = comment
        return Bundle.main.localizedString(forKey: key, value: fallback, table: nil)
    }

    private func date(from value: String?) -> Date? {
        guard let value else { return nil }
        return ISO8601DateFormatter.phoneDex.date(from: value)
    }

    var projectID: String {
        displayWorkspace
            .folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var conversationID: String {
        let thread = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return "\(machineName ?? "")\u{1F}\(thread.isEmpty ? id : thread)"
    }

    func supportsLifecycle(_ capability: String) -> Bool {
        lifecycleCapabilities.contains(capability)
    }

    private static func lastComponent(
        _ value: String?,
        removingGitSuffix: Bool = false
    ) -> String? {
        guard var normalized = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !normalized.isEmpty else {
            return nil
        }
        normalized = normalized.replacingOccurrences(of: "\\", with: "/")
        while normalized.hasSuffix("/") { normalized.removeLast() }
        var component = normalized.split(whereSeparator: { $0 == "/" || $0 == ":" }).last.map(String.init)
        if removingGitSuffix, component?.lowercased().hasSuffix(".git") == true {
            component?.removeLast(4)
        }
        return component
    }

    func controlAvailability(desktopHandoffAvailable: Bool) -> [PhoneDexTaskControlAvailability] {
        var controls = [PhoneDexTaskControlAvailability]()

        if ["queued", "running", "needs_input"].contains(status ?? "") {
            controls.append(PhoneDexTaskControlAvailability(
                id: "cancel",
                title: "Cancel task",
                symbol: "xmark.circle",
                capability: "task.cancel.v1",
                isAvailable: supportsLifecycle("task.cancel.v1"),
                reason: supportsLifecycle("task.cancel.v1")
                    ? "The originating agent can stop this managed run."
                    : "The originating agent did not advertise task.cancel.v1 for this task."
            ))
        }

        if ["failed", "cancelled"].contains(status ?? "") {
            controls.append(PhoneDexTaskControlAvailability(
                id: "retry",
                title: "Retry task",
                symbol: "arrow.clockwise",
                capability: "task.retry.v1",
                isAvailable: supportsLifecycle("task.retry.v1"),
                reason: supportsLifecycle("task.retry.v1")
                    ? "The originating agent can start a managed retry."
                    : "The originating agent did not advertise task.retry.v1 for this task."
            ))
        }

        if let approvalRequest, approvalRequest.state == "pending", !approvalRequest.isExpired {
            controls.append(PhoneDexTaskControlAvailability(
                id: "approval",
                title: "Respond to approval",
                symbol: "checkmark.shield",
                capability: "approval.respond.v1",
                isAvailable: supportsLifecycle("approval.respond.v1"),
                reason: supportsLifecycle("approval.respond.v1")
                    ? "The originating agent can receive this task-version-bound decision."
                    : "The originating agent did not advertise approval.respond.v1 for this request."
            ))
        }

        let hasSession = !(sessionId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "").isEmpty
        controls.append(PhoneDexTaskControlAvailability(
            id: "handoff",
            title: "Desktop handoff",
            symbol: "desktopcomputer.and.arrow.down",
            capability: "desktop.handoff.v1",
            isAvailable: desktopHandoffAvailable,
            reason: desktopHandoffAvailable
                ? "A supported adapter can prepare this task's exact desktop context."
                : hasSession
                    ? "The originating agent did not advertise desktop.handoff.v1 for this task."
                    : "This task has no stable Codex session identity to hand off."
        ))

        return controls
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

struct PhoneDexTaskControlAvailability: Identifiable, Equatable {
    let id: String
    let title: String
    let symbol: String
    let capability: String
    let isAvailable: Bool
    let reason: String
}

struct PhoneDexTaskQuestion: Codable, Equatable {
    let id: String
    let prompt: String
    let choices: [PhoneDexTaskQuestionChoice]
    let allowsFreeText: Bool

    init(id: String, prompt: String, choices: [PhoneDexTaskQuestionChoice], allowsFreeText: Bool) {
        self.id = id
        self.prompt = prompt
        self.choices = choices
        self.allowsFreeText = allowsFreeText
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try PhoneDexNativeDecodeBounds.requiredString(container.decode(String.self, forKey: .id), maxLength: PhoneDexNativeDecodeBounds.id, key: "question.id", decoder: decoder)
        prompt = try PhoneDexNativeDecodeBounds.requiredString(container.decode(String.self, forKey: .prompt), maxLength: PhoneDexNativeDecodeBounds.questionPrompt, key: "question.prompt", decoder: decoder)
        choices = try container.decode([PhoneDexTaskQuestionChoice].self, forKey: .choices)
        try PhoneDexNativeDecodeBounds.count(choices.count, max: PhoneDexNativeDecodeBounds.questionChoices, key: "question.choices", decoder: decoder)
        allowsFreeText = try container.decode(Bool.self, forKey: .allowsFreeText)
    }

    private enum CodingKeys: String, CodingKey { case id, prompt, choices, allowsFreeText }
}

struct PhoneDexTaskQuestionChoice: Codable, Equatable, Identifiable {
    let id: String
    let label: String
}

struct PhoneDexApprovalOrigin: Codable, Equatable {
    let deviceId: String
    let machineName: String
    let workspaceName: String?
}

struct PhoneDexApprovalRequest: Codable, Equatable, Identifiable {
    let id: String
    let taskVersion: Int
    let operation: String
    let scope: String
    let origin: PhoneDexApprovalOrigin
    let reason: String
    let risk: String
    let requestedAt: String
    let expiresAt: String
    let state: String

    var isExpired: Bool {
        guard let expiry = ISO8601DateFormatter.phoneDex.date(from: expiresAt) else { return true }
        return expiry <= Date()
    }

    var expiryDate: Date? {
        ISO8601DateFormatter.phoneDex.date(from: expiresAt)
    }

    var displayState: String {
        if state == "pending" && isExpired { return "Expired" }
        switch state {
        case "pending": return "Awaiting your review"
        case "approved": return "Approved"
        case "rejected": return "Rejected"
        case "expired": return "Expired"
        case "stale": return "No longer current"
        default: return "Unknown approval state"
        }
    }
}

enum PhoneDexApprovalDecision: String, Equatable {
    case approve
    case reject

    var label: String {
        self == .approve ? "Approve" : "Reject"
    }
}

struct PhoneDexQuestionResponse: Codable, Equatable {
    let kind: String
    let choiceId: String?
    let text: String?

    static func choice(_ choiceId: String) -> Self {
        Self(kind: "choice", choiceId: choiceId, text: nil)
    }

    static func text(_ text: String) -> Self {
        Self(kind: "text", choiceId: nil, text: text)
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

struct PhoneDexTaskEvidence: Codable, Equatable {
    let changedFiles: [PhoneDexChangedFile]
    let artifacts: [PhoneDexArtifact]
    let validations: [PhoneDexValidationReceipt]

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        changedFiles = try container.decodeIfPresent([PhoneDexChangedFile].self, forKey: .changedFiles) ?? []
        artifacts = try container.decodeIfPresent([PhoneDexArtifact].self, forKey: .artifacts) ?? []
        validations = try container.decodeIfPresent([PhoneDexValidationReceipt].self, forKey: .validations) ?? []
        try PhoneDexNativeDecodeBounds.count(changedFiles.count, max: PhoneDexNativeDecodeBounds.evidenceItems, key: "evidence.changedFiles", decoder: decoder)
        try PhoneDexNativeDecodeBounds.count(artifacts.count, max: PhoneDexNativeDecodeBounds.evidenceItems, key: "evidence.artifacts", decoder: decoder)
        try PhoneDexNativeDecodeBounds.count(validations.count, max: PhoneDexNativeDecodeBounds.evidenceItems, key: "evidence.validations", decoder: decoder)
    }

    private enum CodingKeys: String, CodingKey { case changedFiles, artifacts, validations }

    init(
        changedFiles: [PhoneDexChangedFile] = [],
        artifacts: [PhoneDexArtifact] = [],
        validations: [PhoneDexValidationReceipt] = []
    ) {
        self.changedFiles = changedFiles
        self.artifacts = artifacts
        self.validations = validations
    }

    var isEmpty: Bool {
        changedFiles.isEmpty && artifacts.isEmpty && validations.isEmpty
    }

    var hasReviewContent: Bool {
        !changedFiles.isEmpty || !validations.isEmpty
    }
}

struct PhoneDexChangedFile: Codable, Equatable, Identifiable {
    let path: String
    let status: String
    let sourceRef: String?
    let summary: String?
    let additions: Int?
    let deletions: Int?
    let patch: String?
    let patchTruncated: Bool?

    init(
        path: String,
        status: String,
        sourceRef: String? = nil,
        summary: String? = nil,
        additions: Int? = nil,
        deletions: Int? = nil,
        patch: String? = nil,
        patchTruncated: Bool? = nil
    ) {
        self.path = path
        self.status = status
        self.sourceRef = sourceRef
        self.summary = summary
        self.additions = additions
        self.deletions = deletions
        self.patch = patch
        self.patchTruncated = patchTruncated
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        path = try PhoneDexNativeDecodeBounds.requiredString(container.decode(String.self, forKey: .path), maxLength: PhoneDexNativeDecodeBounds.path, key: "changedFile.path", decoder: decoder)
        status = try PhoneDexNativeDecodeBounds.requiredString(container.decode(String.self, forKey: .status), maxLength: PhoneDexNativeDecodeBounds.status, key: "changedFile.status", decoder: decoder)
        sourceRef = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .sourceRef), maxLength: PhoneDexNativeDecodeBounds.path, key: "changedFile.sourceRef", decoder: decoder)
        summary = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .summary), maxLength: 600, key: "changedFile.summary", decoder: decoder)
        additions = try container.decodeIfPresent(Int.self, forKey: .additions)
        deletions = try container.decodeIfPresent(Int.self, forKey: .deletions)
        patch = try PhoneDexNativeDecodeBounds.string(container.decodeIfPresent(String.self, forKey: .patch), maxLength: PhoneDexNativeDecodeBounds.patch, key: "changedFile.patch", decoder: decoder)
        patchTruncated = try container.decodeIfPresent(Bool.self, forKey: .patchTruncated)
    }

    private enum CodingKeys: String, CodingKey { case path, status, sourceRef, summary, additions, deletions, patch, patchTruncated }

    var id: String { path }

    var hasPatch: Bool {
        guard let patch else { return false }
        return !patch.isEmpty
    }

    var displayStatus: String {
        switch status {
        case "added": return String(localized: "review.file.added", defaultValue: "Added", comment: "A file was added.")
        case "modified": return String(localized: "review.file.modified", defaultValue: "Modified", comment: "A file was modified.")
        case "deleted": return String(localized: "review.file.deleted", defaultValue: "Deleted", comment: "A file was deleted.")
        case "renamed": return String(localized: "review.file.renamed", defaultValue: "Renamed", comment: "A file was renamed.")
        default: return status.capitalized
        }
    }
}

struct PhoneDexArtifact: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let kind: String
    let sourceRef: String
    let sizeBytes: Int?
    let sha256: String?
    let downloadId: String?
    let mediaType: String?

    var isDownloadable: Bool {
        guard let downloadId else { return false }
        return !downloadId.isEmpty && sha256?.count == 64
    }

    var displaySize: String? {
        guard let sizeBytes else { return nil }
        return ByteCountFormatter.string(fromByteCount: Int64(sizeBytes), countStyle: .file)
    }
}

struct PhoneDexValidationReceipt: Codable, Equatable, Identifiable {
    let id: String
    let name: String
    let status: String
    let summary: String?
    let durationMs: Int?
    let completedAt: String?

    var displayStatus: String {
        switch status {
        case "passed": return String(localized: "review.validation.passed", defaultValue: "Passed", comment: "A validation check passed.")
        case "failed": return String(localized: "review.validation.failed", defaultValue: "Failed", comment: "A validation check failed.")
        case "skipped": return String(localized: "review.validation.skipped", defaultValue: "Skipped", comment: "A validation check was skipped.")
        case "running": return String(localized: "review.validation.running", defaultValue: "Running", comment: "A validation check is running.")
        default: return String(localized: "review.validation.unknown", defaultValue: "Unknown", comment: "A validation check has an unknown status.")
        }
    }

    var symbol: String {
        switch status {
        case "passed": return "checkmark.circle.fill"
        case "failed": return "xmark.octagon.fill"
        case "skipped": return "minus.circle"
        case "running": return "arrow.triangle.2.circlepath"
        default: return "questionmark.circle"
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

struct PhoneDexEvent: Codable, Equatable, Identifiable {
    let id: String
    let taskId: String
    let createdAt: String
    let sequence: Int
    let type: String
    let data: [String: String]

    var displayTitle: String {
        switch type {
        case "task_started": return "Task started"
        case "task_completed": return "Task completed"
        case "task_failed": return "Task failed"
        case "task_cancelled": return "Task cancelled"
        case "needs_input": return "Needs your input"
        case "approval_requested": return "Approval requested"
        case "progress": return "Progress"
        default: return type.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    var symbol: String {
        switch type {
        case "task_started", "progress": return "arrow.triangle.2.circlepath"
        case "task_completed": return "checkmark.circle.fill"
        case "task_failed": return "exclamationmark.triangle.fill"
        case "needs_input": return "questionmark.circle.fill"
        case "approval_requested": return "checkmark.shield.fill"
        case "task_cancelled": return "xmark.circle.fill"
        default: return "circle.fill"
        }
    }

    var displayDate: Date? {
        ISO8601DateFormatter.phoneDex.date(from: createdAt)
    }

    var summary: String? {
        data["summary"]
    }

    var displaySummary: String {
        let normalizedSummary = summary?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return normalizedSummary.isEmpty ? displayTitle : normalizedSummary
    }

    /// Provides a stable order when a hub page contains events with the same sequence.
    /// Sequence is authoritative; timestamp and id only break ties so projection order
    /// cannot change the visible latest-progress event.
    func isLater(than other: PhoneDexEvent) -> Bool {
        if sequence != other.sequence { return sequence > other.sequence }

        let date = displayDate ?? .distantPast
        let otherDate = other.displayDate ?? .distantPast
        if date != otherDate { return date > otherDate }
        return id > other.id
    }

    func isEarlier(than other: PhoneDexEvent) -> Bool {
        if sequence != other.sequence { return sequence < other.sequence }

        let date = displayDate ?? .distantPast
        let otherDate = other.displayDate ?? .distantPast
        if date != otherDate { return date < otherDate }
        return id < other.id
    }

    init(
        id: String,
        taskId: String,
        createdAt: String,
        sequence: Int,
        type: String,
        data: [String: String] = [:]
    ) {
        self.id = id
        self.taskId = taskId
        self.createdAt = createdAt
        self.sequence = sequence
        self.type = type
        self.data = data
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        taskId = try container.decode(String.self, forKey: .taskId)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        sequence = try container.decode(Int.self, forKey: .sequence)
        type = try PhoneDexNativeDecodeBounds.requiredString(container.decode(String.self, forKey: .type), maxLength: PhoneDexNativeDecodeBounds.status, key: "event.type", decoder: decoder)
        data = try container.decodeIfPresent([String: String].self, forKey: .data) ?? [:]
        try PhoneDexNativeDecodeBounds.count(data.count, max: PhoneDexNativeDecodeBounds.eventData, key: "event.data", decoder: decoder)
        for (key, value) in data {
            try PhoneDexNativeDecodeBounds.string(key, maxLength: PhoneDexNativeDecodeBounds.id, key: "event.data.key", decoder: decoder)
            try PhoneDexNativeDecodeBounds.string(value, maxLength: PhoneDexNativeDecodeBounds.eventDataValue, key: "event.data.value", decoder: decoder)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case id, taskId, createdAt, sequence, type, data
    }
}

enum PhoneDexLiveActivityPresentation {
    static let collapsedLimit = 1

    static func visibleEvents(_ events: [PhoneDexEvent], expanded: Bool) -> [PhoneDexEvent] {
        expanded ? events : Array(events.suffix(collapsedLimit))
    }

    static func disclosureTitle(eventCount: Int, expanded: Bool) -> String? {
        guard eventCount > collapsedLimit else { return nil }
        if expanded { return "Show latest activity only" }
        let olderCount = eventCount - collapsedLimit
        return "Show \(olderCount) older event\(olderCount == 1 ? "" : "s")"
    }
}

struct PhoneDexProject: Identifiable, Equatable {
    let id: String
    let name: String
    let machineNames: [String]
    let paths: [String]
    let tasks: [PhoneDexTask]

    var machineName: String { deviceSummary }
    var deviceSummary: String {
        machineNames.count == 1 ? machineNames[0] : "\(machineNames.count) devices"
    }
    var path: String? { paths.count == 1 ? paths[0] : nil }

    init?(tasks: [PhoneDexTask]) {
        guard let first = tasks.first else { return nil }
        id = first.projectID
        name = first.displayWorkspace
        machineNames = Array(Set(tasks.map(\.displayMachine))).sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
        paths = Array(Set(tasks.compactMap { task in
            guard let path = task.cwd?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !path.isEmpty else { return nil }
            return path
        })).sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
        self.tasks = PhoneDexTask.latestPerConversation(tasks).sorted {
            ($0.displayDate ?? .distantPast) > ($1.displayDate ?? .distantPast)
        }
    }

    func matchesSearch(_ query: String) -> Bool {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedQuery.isEmpty else { return true }

        let searchableValues = [name] + machineNames + paths + tasks.flatMap { task in
            [task.title, task.repository, task.branch, task.text]
        }.compactMap { $0 }

        return searchableValues.contains {
            $0.localizedCaseInsensitiveContains(normalizedQuery)
        }
    }

    static func filtered(_ projects: [PhoneDexProject], by query: String) -> [PhoneDexProject] {
        projects.filter { $0.matchesSearch(query) }
    }
}

struct PhoneDexArtifactLibraryItem: Identifiable, Equatable {
    let taskID: String
    let taskTitle: String
    let workspaceName: String
    let machineName: String
    let artifact: PhoneDexArtifact

    var id: String { "\(taskID)-\(artifact.id)" }
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

enum PhoneDexPresentationFilter: String, CaseIterable, Identifiable {
    case active
    case archived
    case muted

    var id: String { rawValue }

    var title: String {
        switch self {
        case .active: return "Active"
        case .archived: return "Archived"
        case .muted: return "Muted"
        }
    }
}

struct PhoneDexTaskFilter: Equatable {
    var scope: PhoneDexChatScope = .needsYou
    var searchText = ""
    var machineName: String?
    var workspaceName: String?
    var presentation: PhoneDexPresentationFilter = .active

    var hasFilters: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            machineName != nil || workspaceName != nil || presentation != .active
    }

    func filteredTasks(_ tasks: [PhoneDexTask], archivedTaskIDs: Set<String> = [], mutedTaskIDs: Set<String> = []) -> [PhoneDexTask] {
        tasks.filter { task in
            scopeMatches(task) &&
                presentationMatches(task, archivedTaskIDs: archivedTaskIDs, mutedTaskIDs: mutedTaskIDs) &&
                (machineName == nil || task.displayMachine == machineName) &&
                (workspaceName == nil || task.displayWorkspace == workspaceName) &&
                searchMatches(task)
        }
    }

    private func presentationMatches(_ task: PhoneDexTask, archivedTaskIDs: Set<String>, mutedTaskIDs: Set<String>) -> Bool {
        switch presentation {
        case .active: return !archivedTaskIDs.contains(task.id) && !mutedTaskIDs.contains(task.id)
        case .archived: return archivedTaskIDs.contains(task.id)
        case .muted: return !archivedTaskIDs.contains(task.id) && mutedTaskIDs.contains(task.id)
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
            return ["queued", "running", "canceling"].contains(task.status ?? "")
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
    let workspaces: [String]

    private enum CodingKeys: String, CodingKey {
        case deviceId, machineName, platform, role, status, lastSeenAt, version, agentVersion, publicUrl, expected, capabilities
        case componentHealth = "health"
        case capabilityDetails, workspaces
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
        workspaces = try container.decodeIfPresent([String].self, forKey: .workspaces) ?? []
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
        capabilityDetails: [PhoneDexCapability] = [],
        workspaces: [String] = []
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
        self.workspaces = workspaces
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
        try container.encode(workspaces, forKey: .workspaces)
    }

    var id: String { deviceId }

    var displayName: String {
        guard let machineName, !machineName.isEmpty else { return deviceId }
        return machineName
    }

    /// Matches synced work to this device without conflating same-named machines.
    /// Older task records may not have a device identity, so they retain a
    /// bounded machine-name fallback when both sides have a real name.
    func owns(_ task: PhoneDexTask) -> Bool {
        if let taskDeviceId = task.deviceId, !taskDeviceId.isEmpty {
            return taskDeviceId == deviceId
        }
        guard let machineName, !machineName.isEmpty,
              let taskMachineName = task.machineName, !taskMachineName.isEmpty else {
            return false
        }
        return taskMachineName == machineName
    }

    /// Returns the latest locally synced row for each conversation owned by this device.
    /// Device identity remains authoritative, with the legacy machine-name fallback
    /// handled by `owns(_:)` for older hub records.
    func conversations(from tasks: [PhoneDexTask]) -> [PhoneDexTask] {
        PhoneDexTask.latestPerConversation(tasks.filter(owns)).sorted { lhs, rhs in
            (lhs.displayDate ?? .distantPast) > (rhs.displayDate ?? .distantPast)
        }
    }

    var isOnline: Bool { status == "online" }

    func supportsCapability(_ capability: String) -> Bool {
        capabilityDetails.contains { $0.identity == capability && $0.supported }
    }
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
    let events: [PhoneDexEvent]

    private enum CodingKeys: String, CodingKey {
        case tasks, devices, events
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        tasks = try container.decodeIfPresent([PhoneDexTask].self, forKey: .tasks) ?? []
        devices = try container.decodeIfPresent([PhoneDexDevice].self, forKey: .devices) ?? []
        events = try container.decodeIfPresent([PhoneDexEvent].self, forKey: .events) ?? []
        try PhoneDexNativeDecodeBounds.count(tasks.count, max: PhoneDexNativeDecodeBounds.syncPageItems, key: "sync.tasks", decoder: decoder)
        try PhoneDexNativeDecodeBounds.count(devices.count, max: PhoneDexNativeDecodeBounds.syncPageItems, key: "sync.devices", decoder: decoder)
        try PhoneDexNativeDecodeBounds.count(events.count, max: PhoneDexNativeDecodeBounds.syncPageItems, key: "sync.events", decoder: decoder)
    }
}

struct PhoneDexSyncChange: Decodable {
    let position: Int
    let kind: String
    let id: String
    let deleted: Bool
    let task: PhoneDexTask?
    let device: PhoneDexDevice?
    let event: PhoneDexEvent?

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
            event = nil
            return
        }

        switch kind {
        case "task":
            task = try container.decode(PhoneDexTask.self, forKey: .record)
            device = nil
            event = nil
        case "device":
            task = nil
            device = try container.decode(PhoneDexDevice.self, forKey: .record)
            event = nil
        case "event":
            task = nil
            device = nil
            event = try container.decode(PhoneDexEvent.self, forKey: .record)
        default:
            throw DecodingError.dataCorrupted(.init(
                codingPath: decoder.codingPath,
                debugDescription: "sync change has unsupported record kind: \(kind)"
            ))
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
