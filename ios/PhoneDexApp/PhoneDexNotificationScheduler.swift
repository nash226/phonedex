import Foundation
import UserNotifications

enum PhoneDexNotificationScheduler {
    static let categoryIdentifier = "PHONEDEX_TASK"

    static func notificationResponseKey(
        notificationID: String,
        actionIdentifier: String,
        taskVersion: Int
    ) -> String {
        "\(notificationID)|v\(max(taskVersion, 1))|\(actionIdentifier)"
    }

    static func notificationCommandID(
        notificationID: String,
        actionIdentifier: String,
        taskVersion: Int
    ) -> String {
        "notification-\(notificationID)-v\(max(taskVersion, 1))-\(actionIdentifier)"
    }

    static let previewBody = """
    Completed: PR #16 merged to main. README now shows PhoneDex as the iPhone-first notification bridge, with Watch support kept as a fallback. Next: start the native iOS app.

    The expanded notification should keep the user in the native iPhone surface, show the full Codex result, and make the next reply obvious without opening a browser.

    Validation passed for the bridge, native notification payload, and project docs. The next useful step is wiring the native app to fetch recent tasks from the local PhoneDex bridge, then post authenticated quick replies back to /reply.

    Reply options stay intentionally small: Okay, what's next for a status-only prompt, Let's do that for the recommended action, and Custom reply for dictated instructions.

    This longer preview is here on purpose so the notification content extension has enough body text to scroll.
    """

    static func requestAuthorization() async throws -> Bool {
        registerCategories()
        return try await UNUserNotificationCenter.current().requestAuthorization(
            options: [.alert, .badge, .sound]
        )
    }

    static func schedulePreviewNotification() async throws {
        registerCategories()
        let identifier = "phonedex-preview"
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])

        let content = UNMutableNotificationContent()
        content.title = "Codex done: PR update"
        content.subtitle = "PhoneDex • MacBook Air"
        content.body = previewBody
        content.categoryIdentifier = categoryIdentifier
        content.threadIdentifier = "phonedex"
        content.sound = .default
        content.userInfo = [
            "taskId": "preview",
            "machineName": "MacBook Air"
        ]

        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )

        try await center.add(request)
    }

    static func scheduleTaskNotification(_ task: PhoneDexTask, bridgeURL: URL) async throws {
        guard bridgeURL.user == nil,
              bridgeURL.password == nil,
              bridgeURL.query == nil,
              bridgeURL.fragment == nil
        else {
            throw PhoneDexNotificationError.credentialBearingBridgeURL
        }

        registerCategories()
        let identifier = "phonedex-task-\(task.id)"
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])

        let content = UNMutableNotificationContent()
        content.title = task.title
        content.subtitle = task.machineName.map { "PhoneDex • \($0)" } ?? "PhoneDex"
        content.body = task.text
        content.categoryIdentifier = categoryIdentifier
        content.threadIdentifier = taskNotificationThreadIdentifier(task)
        content.sound = .default
        content.userInfo = taskNotificationUserInfo(task)

        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )

        try await center.add(request)
    }

    static func taskNotificationUserInfo(_ task: PhoneDexTask) -> [AnyHashable: Any] {
        [
            "taskId": task.id,
            "taskVersion": task.version ?? 1,
            "sessionId": task.sessionId ?? "",
            "machineName": task.machineName ?? ""
        ]
    }

    /// Groups alerts by safe display identity without including task content,
    /// local paths, credentials, or query values in notification metadata.
    static func taskNotificationThreadIdentifier(_ task: PhoneDexTask) -> String {
        let workspace = safeThreadComponent(task.displayWorkspace, fallback: "workspace")
        let machine = safeThreadComponent(task.displayMachine, fallback: "device")
        return "phonedex.\(workspace).\(machine)"
    }

    private static func safeThreadComponent(_ value: String, fallback: String) -> String {
        let allowed = value.unicodeScalars.filter { scalar in
            CharacterSet.alphanumerics.contains(scalar) || scalar == "-" || scalar == "_"
        }
        let normalized = String(String.UnicodeScalarView(allowed))
        return String((normalized.isEmpty ? fallback : normalized).prefix(32))
    }

    static func registerCategories() {
        let next = UNNotificationAction(
            identifier: "PHONEDEX_OKAY_WHATS_NEXT",
            title: "Okay, what's next",
            options: []
        )
        let proceed = UNNotificationAction(
            identifier: "PHONEDEX_LETS_DO_THAT",
            title: "Let's do that",
            options: []
        )
        let custom = UNTextInputNotificationAction(
            identifier: "PHONEDEX_CUSTOM_REPLY",
            title: "Custom reply",
            options: [],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Dictate or type your reply"
        )

        let category = UNNotificationCategory(
            identifier: categoryIdentifier,
            actions: [next, proceed, custom],
            intentIdentifiers: [],
            options: [.customDismissAction]
        )

        UNUserNotificationCenter.current().setNotificationCategories([category])
    }
}

enum PhoneDexNotificationError: LocalizedError, Equatable {
    case credentialBearingBridgeURL

    var errorDescription: String? {
        switch self {
        case .credentialBearingBridgeURL:
            return "The bridge URL must not contain credentials or query parameters."
        }
    }
}
