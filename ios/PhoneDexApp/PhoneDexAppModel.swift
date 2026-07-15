import Foundation

@MainActor
final class PhoneDexAppModel: ObservableObject {
    enum DataSet: Equatable {
        case tasks
        case devices

        var title: String {
            switch self {
            case .tasks: return "conversations"
            case .devices: return "devices"
            }
        }
    }

    enum ConnectionState: Equatable {
        case idle
        case syncing
        case online(Date)
        case stale(Date)
        case offline(Date?)
        case revoked
        case incompatible(message: String, lastSync: Date?)
        case partial(DataSet, message: String, lastSync: Date?)
        case failed(String, lastSync: Date?)

        var isInitialLoading: Bool {
            if case .syncing = self { return true }
            return false
        }

        var blocksEmptyContent: Bool {
            switch self {
            case .syncing, .stale, .offline, .revoked, .incompatible, .partial, .failed:
                return true
            case .idle, .online:
                return false
            }
        }
    }

    enum ReplyState: Equatable {
        case idle
        case sending
        case queued(String)
        case sent(String)
        case failed(String)
    }

    @Published private(set) var tasks: [PhoneDexTask] = []
    @Published private(set) var devices: [PhoneDexDevice] = []
    @Published private(set) var drafts: [PhoneDexTask.ID: String] = [:]
    @Published private(set) var readingPositions: [PhoneDexTask.ID: String] = [:]
    @Published private(set) var pendingReplies: [PhoneDexPendingReply] = []
    @Published var selectedTaskID: PhoneDexTask.ID?
    @Published var connectionState: ConnectionState = .idle
    @Published var replyState: ReplyState = .idle
    @Published private(set) var lastSuccessfulSync: Date?

    static let staleAfter: TimeInterval = 5 * 60

    let settings: PhoneDexSettings
    private let cache: any PhoneDexCacheStoring
    private var syncTasks: [PhoneDexTask] = []
    private var syncCursor: String?

    init(
        settings: PhoneDexSettings,
        cache: any PhoneDexCacheStoring = PhoneDexEncryptedCache()
    ) {
        self.settings = settings
        self.cache = cache
        restoreCachedState()
        loadNotificationReplyResult()
    }

    var selectedTask: PhoneDexTask? {
        tasks.first { $0.id == selectedTaskID }
    }

    var projects: [PhoneDexProject] {
        Dictionary(grouping: tasks, by: \PhoneDexTask.projectID)
            .values
            .map(PhoneDexProject.init(tasks:))
            .sorted { lhs, rhs in
                let nameOrder = lhs.name.localizedCaseInsensitiveCompare(rhs.name)
                if nameOrder != .orderedSame { return nameOrder == .orderedAscending }
                return lhs.machineName.localizedCaseInsensitiveCompare(rhs.machineName) == .orderedAscending
            }
    }

    func refresh() async {
        guard let client = bridgeClient else {
            connectionState = .failed(settings.bridgeURLValidationMessage, lastSync: lastSuccessfulSync)
            return
        }

        connectionState = .syncing
        do {
            let result = try await client.fetchResilientSync(
                cursor: syncCursor,
                tasks: syncTasks,
                devices: devices
            )
            if let fetchedTasks = result.tasks {
                syncTasks = fetchedTasks
                tasks = PhoneDexTask.latestPerConversation(syncTasks).sorted { lhs, rhs in
                    (lhs.displayDate ?? .distantPast) > (rhs.displayDate ?? .distantPast)
                }
            }
            if let fetchedDevices = result.devices {
                devices = fetchedDevices.sorted { lhs, rhs in
                    if lhs.isOnline != rhs.isOnline { return lhs.isOnline }
                    return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
                }
            }
            if selectedTaskID == nil || !tasks.contains(where: { $0.id == selectedTaskID }) {
                selectedTaskID = tasks.first?.id
            }

            let now = Date()
            if result.isComplete {
                lastSuccessfulSync = now
                syncCursor = result.usedCompatibilityFallback ? nil : result.cursor
                await flushPendingReplies()
                persistCachedState(lastSyncAt: now)
                if result.usedCompatibilityFallback {
                    connectionState = .incompatible(
                        message: result.fallbackMessage ?? "This hub is using a compatibility connection.",
                        lastSync: now
                    )
                } else {
                    connectionState = .online(now)
                }
            } else {
                if result.usedCompatibilityFallback { syncCursor = nil }
                persistCachedState(lastSyncAt: lastSuccessfulSync)
                connectionState = .partial(
                    result.availableDataSet,
                    message: result.fallbackMessage ?? "Some PhoneDex data could not be refreshed.",
                    lastSync: lastSuccessfulSync
                )
            }
        } catch let error {
            if error.isRevoked {
                connectionState = .revoked
            } else if error.isProtocolIncompatible {
                connectionState = .incompatible(
                    message: error.localizedDescription,
                    lastSync: lastSuccessfulSync
                )
            } else if error.isOffline {
                if let lastSuccessfulSync,
                   Date().timeIntervalSince(lastSuccessfulSync) >= Self.staleAfter {
                    connectionState = .stale(lastSuccessfulSync)
                } else {
                    connectionState = .offline(lastSuccessfulSync)
                }
            } else if error.isCompatibilityFailure {
                connectionState = .incompatible(
                    message: "This hub does not support the sync contract required for a fresh connection.",
                    lastSync: lastSuccessfulSync
                )
            } else {
                connectionState = .failed(error.localizedDescription, lastSync: lastSuccessfulSync)
            }
        }
    }

    func send(_ choice: PhoneDexReplyChoice, prompt: String? = nil, to task: PhoneDexTask) async -> Bool {
        let text = (prompt ?? choice.prompt).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            replyState = .failed("Write or dictate a reply first.")
            return false
        }
        if case .revoked = connectionState {
            replyState = .failed("Hub access has been revoked. Re-pair before sending replies.")
            return false
        }
        guard let client = bridgeClient else {
            replyState = .failed("The bridge URL is invalid.")
            return false
        }

        let pending = pendingReplies.first(where: { $0.taskId == task.id && $0.prompt == text }) ?? PhoneDexPendingReply(
            commandId: UUID().uuidString,
            idempotencyKey: "ios-\(UUID().uuidString)",
            taskId: task.id,
            choice: choice.rawValue,
            prompt: text,
            expectedTaskVersion: task.version ?? 1,
            sessionId: task.sessionId,
            machineName: task.machineName,
            createdAt: Date()
        )
        if !pendingReplies.contains(where: { $0.id == pending.id }) {
            pendingReplies.append(pending)
            persistCachedState(lastSyncAt: lastSuccessfulSync)
        }
        return await attemptPendingReply(pending, client: client)
    }

    func sendQuestionResponse(
        task: PhoneDexTask,
        questionId: String,
        response: PhoneDexQuestionResponse
    ) async -> Bool {
        guard let question = task.question, question.id == questionId else {
            replyState = .failed("This question is no longer available. Refresh PhoneDex and try again.")
            return false
        }

        let prompt: String
        switch response.kind {
        case "choice":
            guard let choiceId = response.choiceId,
                  let choice = question.choices.first(where: { $0.id == choiceId }) else {
                replyState = .failed("That choice is no longer available. Refresh PhoneDex and try again.")
                return false
            }
            prompt = choice.label
        case "text":
            guard question.allowsFreeText,
                  let text = response.text?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !text.isEmpty else {
                replyState = .failed("This question only accepts its listed choices.")
                return false
            }
            prompt = text
        default:
            replyState = .failed("This question response is not supported by PhoneDex.")
            return false
        }

        guard let client = bridgeClient else {
            replyState = .failed("The bridge URL is invalid.")
            return false
        }
        let pending = pendingReplies.first(where: {
            $0.taskId == task.id && $0.questionId == questionId && $0.questionResponse == response
        }) ?? PhoneDexPendingReply(
            commandId: UUID().uuidString,
            idempotencyKey: "ios-\(UUID().uuidString)",
            taskId: task.id,
            choice: PhoneDexReplyChoice.custom.rawValue,
            prompt: prompt,
            expectedTaskVersion: task.version ?? 1,
            sessionId: task.sessionId,
            machineName: task.machineName,
            createdAt: Date(),
            questionId: questionId,
            questionResponse: response
        )
        if !pendingReplies.contains(where: { $0.id == pending.id }) {
            pendingReplies.append(pending)
            persistCachedState(lastSyncAt: lastSuccessfulSync)
        }
        return await attemptPendingReply(pending, client: client)
    }

    func retryPendingReply(for task: PhoneDexTask) async -> Bool {
        guard let pending = pendingReplies.first(where: { $0.taskId == task.id }),
              let client = bridgeClient else {
            replyState = .failed("The bridge URL is invalid.")
            return false
        }
        return await attemptPendingReply(pending, client: client)
    }

    func pendingReply(for taskID: PhoneDexTask.ID) -> PhoneDexPendingReply? {
        pendingReplies.first(where: { $0.taskId == taskID })
    }

    private func attemptPendingReply(
        _ pending: PhoneDexPendingReply,
        client: PhoneDexBridgeClient
    ) async -> Bool {
        replyState = .sending
        do {
            let receipt = try await client.sendReply(
                choice: PhoneDexReplyChoice(rawValue: pending.choice) ?? .custom,
                prompt: pending.prompt,
                taskId: pending.taskId,
                sessionId: pending.sessionId,
                machineName: pending.machineName,
                commandId: pending.commandId,
                idempotencyKey: pending.idempotencyKey,
                expectedTaskVersion: pending.expectedTaskVersion,
                questionId: pending.questionId,
                questionResponse: pending.questionResponse
            )
            guard receipt.isSuccessful else {
                replyState = .failed(receipt.message ?? "The originating agent did not accept this reply.")
                return false
            }
            pendingReplies.removeAll { $0.id == pending.id }
            persistCachedState(lastSyncAt: lastSuccessfulSync)
            replyState = .sent(receipt.message ?? pending.prompt)
            return true
        } catch {
            if error.isStaleTask {
                pendingReplies.removeAll { $0.id == pending.id }
                persistCachedState(lastSyncAt: lastSuccessfulSync)
                replyState = .failed("This task changed before the reply arrived. Refresh and review the latest context.")
            } else if error.isOffline {
                replyState = .queued(pending.prompt)
            } else {
                replyState = .failed(error.localizedDescription)
            }
            return false
        }
    }

    private func flushPendingReplies() async {
        guard let client = bridgeClient else { return }
        for pending in pendingReplies {
            guard !Task.isCancelled else { return }
            _ = await attemptPendingReply(pending, client: client)
        }
    }

    func loadNotificationReplyResult() {
        guard let result = NotificationReplyResult.latest else { return }
        switch result {
        case .sent(let prompt):
            replyState = .sent(prompt)
        case .failed(let error):
            replyState = .failed(error)
        }
    }

    func draft(for taskID: PhoneDexTask.ID) -> String {
        drafts[taskID] ?? ""
    }

    func updateDraft(_ draft: String, for taskID: PhoneDexTask.ID) {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            drafts.removeValue(forKey: taskID)
        } else {
            drafts[taskID] = draft
        }
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    func readingPosition(for taskID: PhoneDexTask.ID) -> String? {
        readingPositions[taskID]
    }

    func updateReadingPosition(_ position: String?, for taskID: PhoneDexTask.ID) {
        let normalizedPosition = position?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard readingPositions[taskID] != normalizedPosition else { return }

        if let normalizedPosition, !normalizedPosition.isEmpty {
            readingPositions[taskID] = normalizedPosition
        } else {
            readingPositions.removeValue(forKey: taskID)
        }
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    private var bridgeClient: PhoneDexBridgeClient? {
        guard let bridgeURL = settings.normalizedBridgeURL else { return nil }
        return PhoneDexBridgeClient(bridgeURL: bridgeURL, token: settings.token)
    }

    private func restoreCachedState() {
        do {
            guard let cached = try cache.load() else { return }
            syncTasks = cached.tasks
            tasks = PhoneDexTask.latestPerConversation(syncTasks).sorted { lhs, rhs in
                (lhs.displayDate ?? .distantPast) > (rhs.displayDate ?? .distantPast)
            }
            devices = cached.devices
            drafts = cached.drafts
            readingPositions = cached.readingPositions
            pendingReplies = cached.pendingReplies
            syncCursor = cached.cursor
            lastSuccessfulSync = cached.lastSyncAt
            connectionState = .offline(cached.lastSyncAt)
            selectedTaskID = tasks.first?.id
        } catch {
            // A corrupt or unavailable cache must never prevent a fresh sync.
        }
    }

    private func persistCachedState(lastSyncAt: Date?) {
        try? cache.save(
            PhoneDexCachedState(
                cursor: syncCursor,
                tasks: syncTasks,
                devices: devices,
                lastSyncAt: lastSyncAt,
                drafts: drafts,
                readingPositions: readingPositions,
                pendingReplies: pendingReplies
            )
        )
    }
}
