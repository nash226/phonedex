import Foundation

@MainActor
final class PhoneDexAppModel: ObservableObject {
    enum ConnectionState: Equatable {
        case idle
        case syncing
        case online(Date)
        case failed(String)
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

    let settings: PhoneDexSettings

    init(settings: PhoneDexSettings) {
        self.settings = settings
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
            connectionState = .failed("Add a valid bridge URL in Settings.")
            return
        }

        connectionState = .syncing
        do {
            async let taskRequest = client.fetchTasks()
            async let deviceRequest = client.fetchDevices()
            let (fetchedTasks, fetchedDevices) = try await (taskRequest, deviceRequest)
            tasks = PhoneDexTask.latestPerConversation(fetchedTasks).sorted { lhs, rhs in
                (lhs.displayDate ?? .distantPast) > (rhs.displayDate ?? .distantPast)
            }
            devices = fetchedDevices.sorted { lhs, rhs in
                if lhs.isOnline != rhs.isOnline { return lhs.isOnline }
                return lhs.displayName.localizedCaseInsensitiveCompare(rhs.displayName) == .orderedAscending
            }
            if selectedTaskID == nil || !tasks.contains(where: { $0.id == selectedTaskID }) {
                selectedTaskID = tasks.first?.id
            }
            connectionState = .online(Date())
        } catch {
            connectionState = .failed(error.localizedDescription)
        }
    }

    func send(_ choice: PhoneDexReplyChoice, prompt: String? = nil, to task: PhoneDexTask) async -> Bool {
        let text = (prompt ?? choice.prompt).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            replyState = .failed("Write or dictate a reply first.")
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
}
