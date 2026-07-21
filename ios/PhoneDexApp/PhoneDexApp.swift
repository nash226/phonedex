import SwiftUI
import UserNotifications

@main
struct PhoneDexApp: App {
    @StateObject private var settings = PhoneDexSettings()
    @StateObject private var deepLinkRouter = PhoneDexDeepLinkRouter()
    @Environment(\.scenePhase) private var scenePhase

    private let notificationDelegate = PhoneDexNotificationDelegate()

    init() {
        UNUserNotificationCenter.current().delegate = notificationDelegate
        PhoneDexNotificationScheduler.registerCategories()
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                ContentView(settings: settings, deepLinkRouter: deepLinkRouter)
                    .onOpenURL { url in
                        Task {
                            await handle(url)
                        }
                    }
                if PhoneDexPrivacyShieldPolicy.shouldShield(scenePhase) {
                    PhoneDexPrivacyShield()
                }
            }
            .animation(nil, value: scenePhase)
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

        switch PhoneDexDeepLinkRoute(url: url) {
        case .task(let taskID):
            deepLinkRouter.openTask(taskID)
            await recordDeepLinkResult(action: "task")
        case .preview:
            await requestAndSchedulePreview()
        case .notifyLatest:
            await requestAndScheduleLatestTask()
        case .status:
            await recordDeepLinkResult(action: "status")
        case nil:
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
            await recordDeepLinkResult(action: "preview", error: error.phoneDexSafeMessage)
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

            guard !settings.isNotificationMuted(for: task.displayWorkspace) else {
                await recordDeepLinkResult(
                    action: "notify-latest",
                    error: "Notifications are muted for \(task.displayWorkspace)."
                )
                return
            }

            try await PhoneDexNotificationScheduler.scheduleTaskNotification(
                task,
                bridgeURL: bridgeURL,
                privacy: settings.notificationPrivacy,
                mutedWorkspaces: settings.mutedNotificationWorkspaces
            )
            await recordDeepLinkResult(action: "notify-latest")
        } catch {
            await recordDeepLinkResult(action: "notify-latest", error: error.phoneDexSafeMessage)
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

@MainActor
final class PhoneDexDeepLinkRouter: ObservableObject {
    @Published private(set) var pendingTaskID: String?

    func openTask(_ taskID: String) {
        pendingTaskID = taskID
    }

    func clearPendingTask() {
        pendingTaskID = nil
    }
}

enum PhoneDexDeepLinkRoute: Equatable {
    case task(String)
    case preview
    case notifyLatest
    case status

    init?(url: URL) {
        guard url.scheme?.lowercased() == "phonedex",
              url.query == nil,
              url.fragment == nil,
              let host = url.host?.lowercased()
        else { return nil }

        switch host {
        case "task":
            let components = url.path.split(separator: "/", omittingEmptySubsequences: true)
            guard components.count == 1,
                  let taskID = String(components[0]).removingPercentEncoding,
                  Self.isValidTaskID(taskID)
            else { return nil }
            self = .task(taskID)
        case "preview" where url.path.isEmpty:
            self = .preview
        case "notify-latest" where url.path.isEmpty:
            self = .notifyLatest
        case "status" where url.path.isEmpty:
            self = .status
        default:
            return nil
        }
    }

    private static func isValidTaskID(_ taskID: String) -> Bool {
        guard taskID.count <= 128, !taskID.isEmpty else { return false }
        return taskID.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || "_-.:".unicodeScalars.contains($0)
        }
    }
}

enum PhoneDexPrivacyShieldPolicy {
    static func shouldShield(_ scenePhase: ScenePhase) -> Bool {
        scenePhase != .active
    }
}

private struct PhoneDexPrivacyShield: View {
    var body: some View {
        ZStack {
            Color(uiColor: .systemBackground)
                .ignoresSafeArea()
            VStack(spacing: 12) {
                Image(systemName: "lock.shield.fill")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                Text("PhoneDex is protected")
                    .font(.headline)
                Text("Task details are hidden while the app is inactive.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("PhoneDex is protected. Task details are hidden while the app is inactive.")
        .accessibilityAddTraits(.isModal)
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
