import SwiftUI

struct ContentView: View {
    @StateObject private var model = NotificationPreviewModel()
    @StateObject private var settings = PhoneDexSettings()

    var body: some View {
        NavigationStack {
            List {
                Section("Bridge") {
                    TextField("Bridge URL", text: $settings.bridgeURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    SecureField("Token", text: $settings.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section {
                    Button("Allow Notifications") {
                        Task { await model.requestPermission() }
                    }

                    Button("Send Preview Notification") {
                        Task { await model.sendPreviewNotification() }
                    }

                    Button("Fetch Latest Task") {
                        Task { await model.fetchLatestTask(settings: settings) }
                    }

                    Button("Notify Latest Task") {
                        Task { await model.notifyLatestTask(settings: settings) }
                    }
                }

                if let task = model.latestTask {
                    Section("Latest Task") {
                        Text(task.title)
                            .font(.headline)
                        Text(task.text)
                            .font(.body)
                    }
                } else {
                    Section("Preview Text") {
                        Text(PhoneDexNotificationScheduler.previewBody)
                            .font(.body)
                    }
                }

                if !model.status.isEmpty {
                    Section("Status") {
                        Text(model.status)
                    }
                }
            }
            .navigationTitle("PhoneDex")
        }
    }
}

@MainActor
final class NotificationPreviewModel: ObservableObject {
    @Published var status = ""
    @Published var latestTask: PhoneDexTask?

    func requestPermission() async {
        do {
            let allowed = try await PhoneDexNotificationScheduler.requestAuthorization()
            status = allowed ? "Notifications allowed." : "Notifications not allowed."
        } catch {
            status = error.localizedDescription
        }
    }

    func sendPreviewNotification() async {
        do {
            try await PhoneDexNotificationScheduler.schedulePreviewNotification()
            status = "Preview notification scheduled."
        } catch {
            status = error.localizedDescription
        }
    }

    func fetchLatestTask(settings: PhoneDexSettings) async {
        do {
            let tasks = try await client(settings: settings).fetchTasks()
            latestTask = tasks.last
            status = latestTask == nil ? "No tasks returned by bridge." : "Fetched latest task."
        } catch {
            status = error.localizedDescription
        }
    }

    func notifyLatestTask(settings: PhoneDexSettings) async {
        do {
            let bridgeURL = try bridgeURL(settings: settings)
            let task = try await latestTaskOrFetch(settings: settings)
            try await PhoneDexNotificationScheduler.scheduleTaskNotification(
                task,
                bridgeURL: bridgeURL,
                token: settings.token
            )
            status = "Latest task notification scheduled."
        } catch {
            status = error.localizedDescription
        }
    }

    private func latestTaskOrFetch(settings: PhoneDexSettings) async throws -> PhoneDexTask {
        if let latestTask {
            return latestTask
        }
        let tasks = try await client(settings: settings).fetchTasks()
        guard let task = tasks.last else {
            throw PhoneDexViewModelError.noTasks
        }
        latestTask = task
        return task
    }

    private func client(settings: PhoneDexSettings) throws -> PhoneDexBridgeClient {
        PhoneDexBridgeClient(
            bridgeURL: try bridgeURL(settings: settings),
            token: settings.token
        )
    }

    private func bridgeURL(settings: PhoneDexSettings) throws -> URL {
        guard let bridgeURL = settings.normalizedBridgeURL else {
            throw PhoneDexViewModelError.invalidBridgeURL
        }
        return bridgeURL
    }
}

enum PhoneDexViewModelError: LocalizedError {
    case invalidBridgeURL
    case noTasks

    var errorDescription: String? {
        switch self {
        case .invalidBridgeURL:
            return "Bridge URL is invalid."
        case .noTasks:
            return "No tasks returned by bridge."
        }
    }
}
