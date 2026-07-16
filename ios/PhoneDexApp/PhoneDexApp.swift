import SwiftUI
import UserNotifications

@main
struct PhoneDexApp: App {
    @StateObject private var settings = PhoneDexSettings()

    private let notificationDelegate = PhoneDexNotificationDelegate()

    init() {
        UNUserNotificationCenter.current().delegate = notificationDelegate
        PhoneDexNotificationScheduler.registerCategories()
    }

    var body: some Scene {
        WindowGroup {
            ContentView(settings: settings)
                .onOpenURL { url in
                    Task {
                        await handle(url)
                    }
                }
        }
    }

    @MainActor
    private func handle(_ url: URL) async {
        guard url.scheme?.lowercased() == "phonedex" else {
            return
        }

        if settings.apply(configurationURL: url) {
            await recordDeepLinkResult(action: "configure")
            return
        }

        switch url.host?.lowercased() {
        case "preview":
            await requestAndSchedulePreview()
        case "notify-latest":
            await requestAndScheduleLatestTask()
        case "status":
            await recordDeepLinkResult(action: "status")
        default:
            await recordDeepLinkResult(
                action: "ignored",
                error: "Unsupported PhoneDex URL: \(PhoneDexDeepLinkDiagnostics.redactedDescription(for: url))"
            )
        }
    }

    @MainActor
    private func requestAndSchedulePreview() async {
        do {
            let allowed = try await PhoneDexNotificationScheduler.requestAuthorization()
            guard allowed else {
                await recordDeepLinkResult(
                    action: "preview",
                    error: "Notifications are not allowed."
                )
                return
            }

            try await PhoneDexNotificationScheduler.schedulePreviewNotification()
            await recordDeepLinkResult(action: "preview")
        } catch {
            await recordDeepLinkResult(action: "preview", error: error.localizedDescription)
        }
    }

    @MainActor
    private func requestAndScheduleLatestTask() async {
        do {
            guard let bridgeURL = settings.normalizedBridgeURL else {
                await recordDeepLinkResult(
                    action: "notify-latest",
                    error: "Bridge URL is invalid."
                )
                return
            }

            let allowed = try await PhoneDexNotificationScheduler.requestAuthorization()
            guard allowed else {
                await recordDeepLinkResult(
                    action: "notify-latest",
                    error: "Notifications are not allowed."
                )
                return
            }

            let client = PhoneDexBridgeClient(bridgeURL: bridgeURL, token: settings.token)
            guard let task = try await client.fetchTasks().last else {
                await recordDeepLinkResult(
                    action: "notify-latest",
                    error: "No tasks returned by bridge."
                )
                return
            }

            try await PhoneDexNotificationScheduler.scheduleTaskNotification(
                task,
                bridgeURL: bridgeURL
            )
            await recordDeepLinkResult(action: "notify-latest")
        } catch {
            await recordDeepLinkResult(action: "notify-latest", error: error.localizedDescription)
        }
    }

    private func recordDeepLinkResult(action: String, error: String? = nil) async {
        let defaults = UserDefaults.standard
        let notificationSettings = await UNUserNotificationCenter.current().notificationSettings()
        defaults.set(action, forKey: DeepLinkDefaults.action)
        defaults.set(notificationSettings.authorizationStatus.description, forKey: DeepLinkDefaults.authorizationStatus)
        defaults.set(Date().timeIntervalSince1970, forKey: DeepLinkDefaults.updatedAt)

        if let error {
            defaults.set(error, forKey: DeepLinkDefaults.error)
        } else {
            defaults.removeObject(forKey: DeepLinkDefaults.error)
        }
    }

    private enum DeepLinkDefaults {
        static let action = "phonedex.lastDeepLinkAction"
        static let authorizationStatus = "phonedex.lastNotificationAuthorizationStatus"
        static let updatedAt = "phonedex.lastDeepLinkUpdatedAt"
        static let error = "phonedex.lastDeepLinkError"
    }
}

enum PhoneDexDeepLinkDiagnostics {
    static func redactedDescription(for url: URL) -> String {
        guard let scheme = url.scheme?.lowercased() else {
            return "unknown URL"
        }

        var description = "\(scheme):"
        if let host = url.host, !host.isEmpty {
            description += "//\(host)"
        }
        if !url.path.isEmpty {
            description += url.path
        }
        return description
    }
}

private extension UNAuthorizationStatus {
    var description: String {
        switch self {
        case .notDetermined:
            return "notDetermined"
        case .denied:
            return "denied"
        case .authorized:
            return "authorized"
        case .provisional:
            return "provisional"
        case .ephemeral:
            return "ephemeral"
        @unknown default:
            return "unknown"
        }
    }
}
