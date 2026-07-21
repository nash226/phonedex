import Foundation

struct PhoneDexOfflineOutboxSummary: Equatable {
    let replyCount: Int
    let lifecycleCount: Int
    let taskCount: Int

    var totalCount: Int { replyCount + lifecycleCount }

    var title: String {
        totalCount == 1 ? "1 action queued offline" : "\(totalCount) actions queued offline"
    }

    var detail: String {
        let kinds: [String] = [
            replyCount == 0 ? nil : replyCount == 1 ? "1 reply" : "\(replyCount) replies",
            lifecycleCount == 0 ? nil : lifecycleCount == 1 ? "1 task action" : "\(lifecycleCount) task actions"
        ].compactMap { $0 }
        let taskDescription = taskCount == 1 ? "for 1 conversation" : "across \(taskCount) conversations"
        return "\(kinds.joined(separator: " and ")) \(taskDescription). They will retry after a successful sync."
    }

    static let empty = Self(replyCount: 0, lifecycleCount: 0, taskCount: 0)
}

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

    enum DeviceInventoryState: Equatable {
        case empty
        case unavailable

        init(devices: [PhoneDexDevice], connectionState: ConnectionState) {
            if devices.isEmpty && connectionState.blocksEmptyContent {
                self = .unavailable
            } else {
                self = .empty
            }
        }

        var title: String {
            switch self {
            case .empty: return "No computers connected"
            case .unavailable: return "Computer list unavailable"
            }
        }

        var detail: String {
            switch self {
            case .empty:
                return "Pair a Mac or Windows agent to see its health, workspaces, and conversations here."
            case .unavailable:
                return "PhoneDex cannot verify the computer list right now. Refresh before relying on device reachability or task ownership."
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
            switch self {
            case .online, .incompatible:
                // A compatibility response is still a successful sync. The
                // UI should keep the honest degraded state, but must not
                // punish the next automatic refresh with failure backoff.
                return true
            default:
                return false
            }
        }
    }

    enum ReplyState: Equatable {
        case idle
        case sending
        case queued(String)
        case sent(String)
        case duplicate(String)
        case failed(String)
    }

    enum LifecycleState: Equatable {
        case idle
        case sending
        case queued(String)
        case accepted(String)
        case failed(String)

        var isInFlight: Bool {
            if case .sending = self { return true }
            return false
        }
    }

    @Published private(set) var tasks: [PhoneDexTask] = []
    @Published private(set) var devices: [PhoneDexDevice] = []
    @Published private(set) var events: [PhoneDexEvent] = []
    @Published private(set) var drafts: [PhoneDexTask.ID: String] = [:]
    @Published private(set) var readingPositions: [PhoneDexTask.ID: String] = [:]
    @Published private(set) var readAt: [PhoneDexTask.ID: Date] = [:]
    @Published private(set) var pendingReplies: [PhoneDexPendingReply] = []
    @Published private(set) var pendingLifecycleCommands: [PhoneDexPendingLifecycleCommand] = []
    @Published private(set) var replyReceipts: [PhoneDexReplyDeliveryRecord] = []
    @Published private(set) var lifecycleReceipts: [PhoneDexLifecycleDeliveryRecord] = []
    @Published private(set) var cachedArtifacts: [String: PhoneDexCachedArtifact] = [:]
    @Published private(set) var archivedAt: [String: Date] = [:]
    @Published private(set) var mutedAt: [String: Date] = [:]
    @Published var selectedTaskID: PhoneDexTask.ID?
    @Published var connectionState: ConnectionState = .idle
    @Published var replyState: ReplyState = .idle
    @Published var lifecycleState: LifecycleState = .idle
    @Published private(set) var lastSuccessfulSync: Date?
    @Published private(set) var diagnostics: PhoneDexDiagnosticsSnapshot?
    @Published private(set) var cacheRecoveryMessage: String?
    @Published private(set) var localCacheStatusMessage: String?

    static let staleAfter: TimeInterval = 5 * 60

    let settings: PhoneDexSettings
    private let cache: any PhoneDexCacheStoring
    private let approvalAuthenticator: any PhoneDexApprovalAuthenticating
    private let injectedBridgeClient: PhoneDexBridgeClient?
    private var syncTasks: [PhoneDexTask] = []
    private var syncCursor: String?
    private var refreshCoordinator = PhoneDexRefreshCoordinator()
    private var activeRefreshTask: Task<Void, Never>?

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

    var offlineOutboxSummary: PhoneDexOfflineOutboxSummary {
        let taskIDs = Set(pendingReplies.map(\.taskId) + pendingLifecycleCommands.map(\.taskId))
        return PhoneDexOfflineOutboxSummary(
            replyCount: pendingReplies.count,
            lifecycleCount: pendingLifecycleCommands.count,
            taskCount: taskIDs.count
        )
    }

    func pendingLifecycleCommand(for task: PhoneDexTask) -> PhoneDexPendingLifecycleCommand? {
        pendingLifecycleCommands
            .filter { $0.taskId == task.id }
            .max { $0.createdAt < $1.createdAt }
    }

    func latestLifecycleReceipt(for task: PhoneDexTask) -> PhoneDexLifecycleDeliveryRecord? {
        lifecycleReceipts.first {
            $0.taskId == task.id && $0.matchesCurrentTaskVersion(task.version)
        }
    }

    /// Removes commands authenticated by the credential being forgotten.
    /// Cached task history and review artifacts remain available, but an old
    /// reply must never be retried after pairing changes.
    @discardableResult
    func forgetCredential() -> Bool {
        guard settings.forgetCredential() else { return false }

        pendingReplies.removeAll()
        pendingLifecycleCommands.removeAll()
        replyState = .idle
        persistCachedState(lastSyncAt: lastSuccessfulSync)
        return true
    }

    var projects: [PhoneDexProject] {
        Dictionary(grouping: tasks, by: \PhoneDexTask.projectID)
            .values
            .compactMap(PhoneDexProject.init(tasks:))
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
        activeRefreshTask?.cancel()
        let requestID = refreshCoordinator.begin()
        let refreshTask = Task { @MainActor [weak self] in
            guard let self else { return }
            await self.performRefresh(requestID: requestID)
        }
        activeRefreshTask = refreshTask
        await refreshTask.value
    }

    private func performRefresh(requestID: Int) async {
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
            try Task.checkCancellation()
            guard !refreshCoordinator.shouldCancel(requestID) else { return }
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
                // A complete sync has rebuilt the local projection. Do not
                // leave a one-time cache recovery warning visible after the
                // user has successfully recovered from the hub.
                cacheRecoveryMessage = nil
                settings.clearCacheRestoreBypass()
                try Task.checkCancellation()
                guard !refreshCoordinator.shouldCancel(requestID) else { return }
                await flushPendingReplies()
                await flushPendingLifecycleCommands()
                try Task.checkCancellation()
                guard !refreshCoordinator.shouldCancel(requestID) else { return }
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
        } catch is CancellationError {
            return
        } catch let error {
            guard !Task.isCancelled else { return }
            guard !refreshCoordinator.shouldCancel(requestID) else { return }
            if error.isRevoked {
                connectionState = .revoked
            } else if error.isProtocolIncompatible {
                connectionState = .incompatible(
                    message: error.phoneDexSafeMessage,
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
                connectionState = .failed(error.phoneDexSafeMessage, lastSync: lastSuccessfulSync)
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

    /// Removes all task, review, command, and diagnostics data stored on this
    /// iPhone while keeping the paired bridge credential in Keychain. The
    /// empty state is written before published properties change so a failed
    /// persistence operation cannot present a reset that did not stick.
    @discardableResult
    func clearLocalCache() -> Bool {
        let emptyState = PhoneDexCachedState(
            cursor: nil,
            tasks: [],
            devices: [],
            events: [],
            lastSyncAt: nil,
            drafts: [:],
            readingPositions: [:],
            readAt: [:],
            archivedAt: [:],
            mutedAt: [:],
            pendingReplies: [],
            pendingLifecycleCommands: [],
            replyReceipts: [],
            lifecycleReceipts: [],
            handledNotificationResponses: [:],
            cachedArtifacts: []
        )

        do {
            try cache.save(emptyState)
        } catch {
            localCacheStatusMessage = "Local data could not be cleared. Try again."
            return false
        }

        activeRefreshTask?.cancel()
        _ = refreshCoordinator.begin()
        syncTasks = []
        syncCursor = nil
        tasks = []
        devices = []
        events = []
        drafts = [:]
        readingPositions = [:]
        readAt = [:]
        archivedAt = [:]
        mutedAt = [:]
        pendingReplies = []
        pendingLifecycleCommands = []
        replyReceipts = []
        lifecycleReceipts = []
        cachedArtifacts = [:]
        lastSuccessfulSync = nil
        selectedTaskID = nil
        diagnostics = nil
        connectionState = .idle
        replyState = .idle
        lifecycleState = .idle
        cacheRecoveryMessage = nil
        localCacheStatusMessage = "Local task, review, and offline data cleared. Your paired credential was kept."
        return true
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
        guard text.utf8.count <= PhoneDexPendingReplyPolicy.promptBytesLimit else {
            replyState = .failed("This reply is too long to queue safely. Keep it under 64 KB.")
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
            prunePendingReplies(now: Date())
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

        guard prompt.utf8.count <= PhoneDexPendingReplyPolicy.promptBytesLimit else {
            replyState = .failed("This answer is too long to queue safely. Keep it under 64 KB.")
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
            prunePendingReplies(now: Date())
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
        guard !lifecycleState.isInFlight else { return false }
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
                lifecycleState = .failed(error.phoneDexSafeMessage)
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
        guard !lifecycleState.isInFlight else { return nil }
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
            recordLifecycleReceipt(result.receipt, kind: "handoff", taskId: task.id)
            persistCachedState(lastSyncAt: lastSuccessfulSync)
            if let updatedTask = result.task { upsertLifecycleTask(updatedTask) }
            guard let handoff = result.handoff else {
                lifecycleState = .failed("The agent accepted the request without returning handoff context.")
                return nil
            }
            lifecycleState = .accepted(result.receipt.message ?? "Desktop handoff prepared.")
            return handoff
        } catch {
            lifecycleState = .failed(error.phoneDexSafeMessage)
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
        guard !lifecycleState.isInFlight else { return false }
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
            recordLifecycleReceipt(
                result.receipt,
                kind: "create_task",
                taskId: result.receipt.taskId ?? result.task?.id ?? ""
            )
            if let task = result.task { upsertLifecycleTask(task) }
            persistCachedState(lastSyncAt: lastSuccessfulSync)
            lifecycleState = result.receipt.isSuccessful
                ? .accepted(result.receipt.message ?? "Task queued.")
                : .failed(result.receipt.message ?? "The originating agent did not accept this task.")
            return result.receipt.isSuccessful
        } catch {
            lifecycleState = .failed(error.phoneDexSafeMessage)
            return false
        }
    }

    private func sendLifecycle(
        kind: String,
        task: PhoneDexTask,
        approvalId: String? = nil,
        approvalTaskVersion: Int? = nil
    ) async -> Bool {
        guard !lifecycleState.isInFlight else { return false }
        guard bridgeClient != nil else {
            lifecycleState = .failed("The bridge URL is invalid.")
            return false
        }
        let queuesWhenOffline = PhoneDexPendingLifecycleCommandPolicy.supportedKinds.contains(kind)
        let pending = queuesWhenOffline ? (pendingLifecycleCommands.first {
            $0.kind == kind && $0.taskId == task.id && $0.expectedTaskVersion == (task.version ?? 1)
        } ?? PhoneDexPendingLifecycleCommand(
            commandId: UUID().uuidString,
            idempotencyKey: "ios-\(UUID().uuidString)",
            kind: kind,
            taskId: task.id,
            expectedTaskVersion: task.version ?? 1,
            createdAt: Date()
        )) : nil
        if let pending, !pendingLifecycleCommands.contains(where: { $0.id == pending.id }) {
            pendingLifecycleCommands.append(pending)
            prunePendingLifecycleCommands(now: Date())
            persistCachedState(lastSyncAt: lastSuccessfulSync)
        }
        return await attemptLifecycleCommand(
            kind: kind,
            task: task,
            approvalId: approvalId,
            approvalTaskVersion: approvalTaskVersion,
            commandId: pending?.commandId,
            idempotencyKey: pending?.idempotencyKey,
            queuesWhenOffline: queuesWhenOffline
        )
    }

    private func attemptLifecycleCommand(
        kind: String,
        task: PhoneDexTask,
        approvalId: String? = nil,
        approvalTaskVersion: Int? = nil,
        commandId: String? = nil,
        idempotencyKey: String? = nil,
        queuesWhenOffline: Bool = false
    ) async -> Bool {
        guard let client = bridgeClient else {
            lifecycleState = .failed("The bridge URL is invalid.")
            return false
        }
        lifecycleState = .sending
        let resolvedCommandId = commandId ?? UUID().uuidString
        let resolvedIdempotencyKey = idempotencyKey ?? "ios-\(UUID().uuidString)"
        do {
            let result = try await client.sendLifecycleCommand(
                kind: kind,
                taskId: task.id,
                approvalId: approvalId,
                approvalTaskVersion: approvalTaskVersion,
                commandId: resolvedCommandId,
                idempotencyKey: resolvedIdempotencyKey,
                expectedTaskVersion: task.version ?? 1
            )
            recordLifecycleReceipt(result.receipt, kind: kind, taskId: task.id)
            if let updatedTask = result.task { upsertLifecycleTask(updatedTask) }
            if result.receipt.isSuccessful {
                pendingLifecycleCommands.removeAll { $0.commandId == resolvedCommandId }
            }
            persistCachedState(lastSyncAt: lastSuccessfulSync)
            lifecycleState = result.receipt.isSuccessful
                ? .accepted(result.receipt.message ?? "Command accepted.")
                : .failed(result.receipt.message ?? "The originating agent did not accept this action.")
            return result.receipt.isSuccessful
        } catch {
            if queuesWhenOffline, error.isOffline {
                let description = kind == "cancel" ? "Cancellation queued until the hub reconnects." : "Retry queued until the hub reconnects."
                lifecycleState = .queued(description)
                return false
            }
            if error.isStaleTask {
                if let commandId {
                    pendingLifecycleCommands.removeAll { $0.commandId == commandId }
                    persistCachedState(lastSyncAt: lastSuccessfulSync)
                }
                lifecycleState = .failed("This task changed before the action arrived. Refresh and review the latest context.")
                return false
            }
            if let commandId {
                pendingLifecycleCommands.removeAll { $0.commandId == commandId }
                persistCachedState(lastSyncAt: lastSuccessfulSync)
            }
            lifecycleState = .failed(error.phoneDexSafeMessage)
            return false
        }
    }

    private func recordLifecycleReceipt(_ receipt: PhoneDexReplyReceipt, kind: String, taskId: String) {
        let record = PhoneDexLifecycleDeliveryRecord(receipt: receipt, kind: kind, taskId: taskId)
        lifecycleReceipts.removeAll { $0.id == record.id }
        lifecycleReceipts.insert(record, at: 0)
        if lifecycleReceipts.count > 50 {
            lifecycleReceipts.removeLast(lifecycleReceipts.count - 50)
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
                replyState = .failed(error.phoneDexSafeMessage)
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
        prunePendingReplies(now: Date())
        persistCachedState(lastSyncAt: lastSuccessfulSync)
        for pending in pendingReplies {
            guard !Task.isCancelled else { return }
            _ = await attemptPendingReply(pending, client: client)
        }
    }

    private func flushPendingLifecycleCommands() async {
        guard bridgeClient != nil else { return }
        pendingLifecycleCommands = PhoneDexPendingLifecycleCommandPolicy.prune(pendingLifecycleCommands, now: Date())
        persistCachedState(lastSyncAt: lastSuccessfulSync)
        for pending in pendingLifecycleCommands {
            guard !Task.isCancelled else { return }
            guard let task = tasks.first(where: { $0.id == pending.taskId }) else { continue }
            _ = await attemptLifecycleCommand(
                kind: pending.kind,
                task: task,
                commandId: pending.commandId,
                idempotencyKey: pending.idempotencyKey,
                queuesWhenOffline: true
            )
        }
    }

    func loadNotificationReplyResult() {
        guard let result = NotificationReplyResult.latest() else { return }
        switch result {
        case .sent(let prompt):
            replyState = .sent(prompt)
        case .failed(let error):
            replyState = .failed(error)
        case .duplicate(let message):
            replyState = .duplicate(message)
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

    func isRead(_ task: PhoneDexTask) -> Bool {
        guard let markedReadAt = readAt[task.id] else { return false }
        guard let taskUpdatedAt = task.lastUpdatedDate else { return true }
        return markedReadAt >= taskUpdatedAt
    }

    func markRead(_ task: PhoneDexTask) {
        guard !isRead(task) else { return }
        readAt[task.id] = Date()
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    func markUnread(_ task: PhoneDexTask) {
        guard readAt.removeValue(forKey: task.id) != nil else { return }
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    func isArchived(_ task: PhoneDexTask) -> Bool {
        archivedAt[task.id] != nil
    }

    func setArchived(_ archived: Bool, for task: PhoneDexTask) {
        if archived {
            archivedAt[task.id] = Date()
        } else {
            archivedAt.removeValue(forKey: task.id)
        }
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    func isMuted(_ task: PhoneDexTask) -> Bool {
        mutedAt[task.id] != nil
    }

    func setMuted(_ muted: Bool, for task: PhoneDexTask) {
        if muted {
            mutedAt[task.id] = Date()
        } else {
            mutedAt.removeValue(forKey: task.id)
        }
        persistCachedState(lastSyncAt: lastSuccessfulSync)
    }

    func events(for taskID: PhoneDexTask.ID) -> [PhoneDexEvent] {
        events
            .filter { $0.taskId == taskID }
            .sorted { $0.isEarlier(than: $1) }
    }

    func latestEvent(for taskID: PhoneDexTask.ID) -> PhoneDexEvent? {
        events(for: taskID).last
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
        if settings.shouldBypassCacheRestore {
            cacheRecoveryMessage = "PhoneDex is starting without its previous local cache. Fresh data will be fetched when the hub is reachable."
            return
        }

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
            readAt = cached.readAt
            archivedAt = cached.archivedAt
            mutedAt = cached.mutedAt
            let persistedPendingReplies = PhoneDexPendingReplyPolicy.prune(cached.pendingReplies, now: Date())
            pendingReplies = persistedPendingReplies
            let persistedLifecycleCommands = PhoneDexPendingLifecycleCommandPolicy.prune(cached.pendingLifecycleCommands, now: Date())
            pendingLifecycleCommands = persistedLifecycleCommands
            replyReceipts = cached.replyReceipts
            lifecycleReceipts = cached.lifecycleReceipts
            let persistedArtifacts = PhoneDexCachedArtifactPolicy.index(cached.cachedArtifacts)
            cachedArtifacts = persistedArtifacts
            pruneCachedArtifacts(now: Date())
            syncCursor = cached.cursor
            lastSuccessfulSync = cached.lastSyncAt
            connectionState = .offline(cached.lastSyncAt)
            selectedTaskID = tasks.first?.id

            // Retention is a privacy boundary, not just a view concern. Rewrite
            // the encrypted cache during restore so expired artifact bytes do
            // not remain on disk until an unrelated later mutation.
            if cachedArtifacts != persistedArtifacts || cached.pendingReplies != persistedPendingReplies || cached.pendingLifecycleCommands != persistedLifecycleCommands {
                if cached.pendingReplies != persistedPendingReplies {
                    cacheRecoveryMessage = "Older offline replies were removed from this iPhone. Fresh replies can be queued when needed."
                }
                if cached.pendingLifecycleCommands != persistedLifecycleCommands {
                    cacheRecoveryMessage = "Older offline actions were removed from this iPhone. Try the action again when needed."
                }
                persistCachedState(lastSyncAt: cached.lastSyncAt)
            }
        } catch {
            // A corrupt or unavailable cache must never prevent a fresh sync.
            // Move a corrupt file aside so notification actions and the next
            // launch can start from a clean encrypted state instead of
            // retrying the same failure forever.
            do {
                try cache.quarantine()
            } catch {
                // If the file cannot be moved aside, remember that this
                // projection is untrusted so a cold relaunch does not retry
                // the same failing decode indefinitely.
                settings.markCacheRestoreBypassNeeded()
            }
            cacheRecoveryMessage = "PhoneDex could not restore its local cache. Fresh data will be fetched when the hub is reachable."
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
                readAt: readAt,
                archivedAt: archivedAt,
                mutedAt: mutedAt,
                pendingReplies: pendingReplies,
                pendingLifecycleCommands: pendingLifecycleCommands,
                replyReceipts: replyReceipts,
                lifecycleReceipts: lifecycleReceipts,
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

    private func prunePendingReplies(now: Date) {
        pendingReplies = PhoneDexPendingReplyPolicy.prune(pendingReplies, now: now)
    }

    private func prunePendingLifecycleCommands(now: Date) {
        pendingLifecycleCommands = PhoneDexPendingLifecycleCommandPolicy.prune(pendingLifecycleCommands, now: now)
    }
}
