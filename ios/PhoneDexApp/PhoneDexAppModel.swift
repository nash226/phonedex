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
        case sent(String)
        case failed(String)
    }

    @Published private(set) var tasks: [PhoneDexTask] = []
    @Published private(set) var devices: [PhoneDexDevice] = []
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
            connectionState = .failed("Add a valid bridge URL in Settings.", lastSync: lastSuccessfulSync)
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

        replyState = .sending
        do {
            try await client.sendReply(
                choice: choice,
                prompt: text,
                taskId: task.id,
                sessionId: task.sessionId,
                machineName: task.machineName
            )
            replyState = .sent(text)
            return true
        } catch {
            replyState = .failed(error.localizedDescription)
            return false
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
            syncCursor = cached.cursor
            lastSuccessfulSync = cached.lastSyncAt
            connectionState = .offline(cached.lastSyncAt)
            selectedTaskID = tasks.first?.id
        } catch {
            // A corrupt or unavailable cache must never prevent a fresh sync.
        }
    }

    private func persistCachedState(lastSyncAt: Date?) {
        guard let lastSyncAt else { return }
        try? cache.save(
            PhoneDexCachedState(
                cursor: syncCursor,
                tasks: syncTasks,
                devices: devices,
                lastSyncAt: lastSyncAt
            )
        )
    }
}
