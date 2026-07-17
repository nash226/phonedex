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

        var supportsAutomaticRefreshReset: Bool {
            if case .online = self { return true }
            return false
        }
    }

    enum ReplyState: Equatable {
        case idle
        case sending
        case queued(String)
        case sent(String)
        case failed(String)
    }

    enum LifecycleState: Equatable {
        case idle
        case sending
        case accepted(String)
        case failed(String)
    }

    @Published private(set) var tasks: [PhoneDexTask] = []
    @Published private(set) var devices: [PhoneDexDevice] = []
    @Published private(set) var events: [PhoneDexEvent] = []
    @Published private(set) var drafts: [PhoneDexTask.ID: String] = [:]
    @Published private(set) var readingPositions: [PhoneDexTask.ID: String] = [:]
    @Published private(set) var pendingReplies: [PhoneDexPendingReply] = []
    @Published private(set) var replyReceipts: [PhoneDexReplyDeliveryRecord] = []
    @Published private(set) var cachedArtifacts: [String: PhoneDexCachedArtifact] = [:]
    @Published var selectedTaskID: PhoneDexTask.ID?
    @Published var connectionState: ConnectionState = .idle
    @Published var replyState: ReplyState = .idle
    @Published var lifecycleState: LifecycleState = .idle
    @Published private(set) var lastSuccessfulSync: Date?
    @Published private(set) var diagnostics: PhoneDexDiagnosticsSnapshot?

    static let staleAfter: TimeInterval = 5 * 60

    let settings: PhoneDexSettings
    private let cache: any PhoneDexCacheStoring
    private let approvalAuthenticator: any PhoneDexApprovalAuthenticating
    private let injectedBridgeClient: PhoneDexBridgeClient?
    private var syncTasks: [PhoneDexTask] = []
    private var syncCursor: String?

    init(
        settings: PhoneDexSettings,
        cache: any PhoneDexCacheStoring = PhoneDexEncryptedCache(),
        approvalAuthenticator: any PhoneDexApprovalAuthenticating = PhoneDexApprovalAuthenticator(),
        bridgeClient: PhoneDexBridgeClient? = nil
    ) {
        self.settings = settings
        self.cache = cache
        self.approvalAuthenticator = approvalAuthenticator
        self.injectedBridgeClient = bridgeClient
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

    var artifactLibrary: [PhoneDexArtifactLibraryItem] {
        tasks.flatMap { task in
            (task.evidence?.artifacts ?? []).map {
                PhoneDexArtifactLibraryItem(
                    taskID: task.id,
                    taskTitle: task.title,
                    workspaceName: task.displayWorkspace,
                    machineName: task.displayMachine,
                    artifact: $0
                )
            }
        }.sorted {
            $0.taskTitle.localizedCaseInsensitiveCompare($1.taskTitle) == .orderedAscending
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
                devices: devices,
                events: events
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
            if let fetchedEvents = result.events {
                events = fetchedEvents.sorted { lhs, rhs in
                    if lhs.taskId != rhs.taskId { return lhs.taskId < rhs.taskId }
                    return lhs.sequence < rhs.sequence
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

    func downloadArtifact(_ artifact: PhoneDexArtifact) async throws -> Data {
        guard let client = bridgeClient else {
            throw PhoneDexBridgeClientError.invalidURL
        }
        let data = try await client.downloadArtifact(artifact)
        let cached = PhoneDexCachedArtifact(
            id: artifact.id,
            name: artifact.name,
            mediaType: artifact.mediaType,
            data: data,
            downloadedAt: Date()
        )
        cachedArtifacts[artifact.id] = cached
        pruneCachedArtifacts(now: cached.downloadedAt)
        persistCachedState(lastSyncAt: lastSuccessfulSync)
        return data
    }

    func cachedArtifactData(for artifact: PhoneDexArtifact) -> Data? {
        cachedArtifacts[artifact.id]?.data
    }

    var cachedArtifactBytes: Int {
        cachedArtifacts.values.reduce(0) { $0 + $1.byteCount }
    }

    func clearCachedArtifacts() {
        cachedArtifacts.removeAll()
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    func fetchDiagnostics() async throws -> PhoneDexDiagnosticsSnapshot {
        guard let client = bridgeClient else {
            throw PhoneDexBridgeClientError.invalidURL
        }
        let snapshot = try await client.fetchDiagnostics()
        diagnostics = snapshot
        return snapshot
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

    func cancel(task: PhoneDexTask) async -> Bool {
        await sendLifecycle(kind: "cancel", task: task)
    }

    func retry(task: PhoneDexTask) async -> Bool {
        await sendLifecycle(kind: "retry", task: task)
    }

    func respondToApproval(_ decision: PhoneDexApprovalDecision, for task: PhoneDexTask) async -> Bool {
        guard let request = task.approvalRequest,
              request.state == "pending",
              !request.isExpired,
              task.supportsLifecycle("approval.respond.v1") else {
            lifecycleState = .failed("This approval is no longer available from the originating agent. Refresh before trying again.")
            return false
        }

        if settings.requireApprovalAuthentication {
            do {
                try await approvalAuthenticator.authenticate()
            } catch {
                lifecycleState = .failed(error.localizedDescription)
                return false
            }
        }

        return await sendLifecycle(
            kind: decision.rawValue,
            task: task,
            approvalId: request.id,
            approvalTaskVersion: request.taskVersion
        )
    }

    func prepareDesktopHandoff(task: PhoneDexTask) async -> PhoneDexDesktopHandoff? {
        guard let client = bridgeClient else {
            lifecycleState = .failed("The bridge URL is invalid.")
            return nil
        }
        lifecycleState = .sending
        do {
            let result = try await client.sendLifecycleCommand(
                kind: "handoff",
                taskId: task.id,
                expectedTaskVersion: task.version ?? 1
            )
            if let updatedTask = result.task { upsertLifecycleTask(updatedTask) }
            guard let handoff = result.handoff else {
                lifecycleState = .failed("The agent accepted the request without returning handoff context.")
                return nil
            }
            lifecycleState = .accepted(result.receipt.message ?? "Desktop handoff prepared.")
            return handoff
        } catch {
            lifecycleState = .failed(error.localizedDescription)
            return nil
        }
    }

    func supportsDesktopHandoff(for task: PhoneDexTask) -> Bool {
        guard let sessionId = task.sessionId?.trimmingCharacters(in: .whitespacesAndNewlines),
              !sessionId.isEmpty else { return false }
        if task.supportsLifecycle("desktop.handoff.v1") { return true }
        return devices.first {
            if let deviceId = task.deviceId, deviceId == $0.deviceId { return true }
            return task.machineName?.isEmpty == false && task.machineName == $0.machineName
        }?.supportsCapability("desktop.handoff.v1") == true
    }

    func controlAvailability(for task: PhoneDexTask) -> [PhoneDexTaskControlAvailability] {
        task.controlAvailability(desktopHandoffAvailable: supportsDesktopHandoff(for: task))
    }

    func createTask(deviceId: String, workspaceName: String, prompt: String) async -> Bool {
        guard let client = bridgeClient else {
            lifecycleState = .failed("The bridge URL is invalid.")
            return false
        }
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedPrompt.isEmpty else {
            lifecycleState = .failed("Enter a prompt before starting a task.")
            return false
        }
        lifecycleState = .sending
        do {
            let result = try await client.sendLifecycleCommand(
                kind: "create_task",
                deviceId: deviceId,
                workspaceName: workspaceName,
                prompt: trimmedPrompt
            )
            if let task = result.task { upsertLifecycleTask(task) }
            lifecycleState = .accepted(result.receipt.message ?? "Task queued.")
            return result.receipt.isSuccessful
        } catch {
            lifecycleState = .failed(error.localizedDescription)
            return false
        }
    }

    private func sendLifecycle(
        kind: String,
        task: PhoneDexTask,
        approvalId: String? = nil,
        approvalTaskVersion: Int? = nil
    ) async -> Bool {
        guard let client = bridgeClient else {
            lifecycleState = .failed("The bridge URL is invalid.")
            return false
        }
        lifecycleState = .sending
        do {
            let result = try await client.sendLifecycleCommand(
                kind: kind,
                taskId: task.id,
                approvalId: approvalId,
                approvalTaskVersion: approvalTaskVersion,
                expectedTaskVersion: task.version ?? 1
            )
            if let updatedTask = result.task { upsertLifecycleTask(updatedTask) }
            lifecycleState = .accepted(result.receipt.message ?? "Command accepted.")
            return result.receipt.isSuccessful
        } catch {
            lifecycleState = .failed(error.localizedDescription)
            return false
        }
    }

    private func upsertLifecycleTask(_ task: PhoneDexTask) {
        if let index = syncTasks.firstIndex(where: { $0.id == task.id }) {
            syncTasks[index] = task
        } else {
            syncTasks.append(task)
        }
        tasks = PhoneDexTask.latestPerConversation(syncTasks).sorted {
            ($0.displayDate ?? .distantPast) > ($1.displayDate ?? .distantPast)
        }
        selectedTaskID = task.id
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    func pendingReply(for taskID: PhoneDexTask.ID) -> PhoneDexPendingReply? {
        pendingReplies.first(where: { $0.taskId == taskID })
    }

    func latestReplyReceipt(for taskID: PhoneDexTask.ID) -> PhoneDexReplyDeliveryRecord? {
        replyReceipts.first { $0.taskId == taskID }
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
            recordReplyReceipt(receipt, for: pending)
            guard receipt.isSuccessful else {
                persistCachedState(lastSyncAt: lastSuccessfulSync)
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

    private func recordReplyReceipt(_ receipt: PhoneDexReplyReceipt, for pending: PhoneDexPendingReply) {
        let record = PhoneDexReplyDeliveryRecord(receipt: receipt, pending: pending)
        replyReceipts.removeAll { $0.id == record.id }
        replyReceipts.insert(record, at: 0)
        if replyReceipts.count > 50 {
            replyReceipts.removeLast(replyReceipts.count - 50)
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
        case .duplicate(let message):
            replyState = .failed(message)
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

    func events(for taskID: PhoneDexTask.ID) -> [PhoneDexEvent] {
        events
            .filter { $0.taskId == taskID }
            .sorted { $0.sequence < $1.sequence }
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
        if let injectedBridgeClient {
            return injectedBridgeClient
        }
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
            events = cached.events
            drafts = cached.drafts
            readingPositions = cached.readingPositions
            pendingReplies = cached.pendingReplies
            replyReceipts = cached.replyReceipts
            cachedArtifacts = PhoneDexCachedArtifactPolicy.index(cached.cachedArtifacts)
            pruneCachedArtifacts(now: Date())
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
                events: events,
                lastSyncAt: lastSyncAt,
                drafts: drafts,
                readingPositions: readingPositions,
                pendingReplies: pendingReplies,
                replyReceipts: replyReceipts,
                handledNotificationResponses: (try? cache.load())?.handledNotificationResponses ?? [:],
                cachedArtifacts: cachedArtifacts.values.sorted { $0.downloadedAt > $1.downloadedAt }
            )
        )
    }

    private func pruneCachedArtifacts(now: Date) {
        cachedArtifacts = PhoneDexCachedArtifactPolicy.index(
            PhoneDexCachedArtifactPolicy.prune(Array(cachedArtifacts.values), now: now)
        )
    }
}
