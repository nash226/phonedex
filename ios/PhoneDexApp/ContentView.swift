import SwiftUI

struct ContentView: View {
    @StateObject private var model = NotificationPreviewModel()

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button("Allow Notifications") {
                        Task { await model.requestPermission() }
                    }

                    Button("Send Preview Notification") {
                        Task { await model.sendPreviewNotification() }
                    }
                }

                Section("Preview Text") {
                    Text(PhoneDexNotificationScheduler.previewBody)
                        .font(.body)
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
}
