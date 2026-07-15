import Foundation
import UserNotifications

enum PhoneDexNotificationScheduler {
    static let categoryIdentifier = "PHONEDEX_TASK"

    static let previewBody = """
    Completed: PR #16 merged to main. README now shows PhoneDex as the iPhone-first notification bridge, with Watch support kept as a fallback. Next: start the native iOS app.

    The expanded notification should keep the user in the native iPhone surface, show the full Codex result, and make the next reply obvious without opening a browser.

    Validation passed for the bridge, native notification payload, and project docs. The next useful step is wiring the native app to fetch recent tasks from the local PhoneDex bridge, then post quick replies back to /reply with the task token.

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
            "machineName": "MacBook Air",
            "replyUrl": "http://127.0.0.1:8765/reply"
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
        content.threadIdentifier = "phonedex"
        content.sound = .default
        content.userInfo = taskNotificationUserInfo(task, bridgeURL: bridgeURL)

        let request = UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)
        )

        try await center.add(request)
    }

    static func taskNotificationUserInfo(_ task: PhoneDexTask, bridgeURL: URL) -> [AnyHashable: Any] {
        [
            "taskId": task.id,
            "sessionId": task.sessionId ?? "",
            "machineName": task.machineName ?? "",
            "replyUrl": bridgeURL.appending(path: "reply").absoluteString,
            "bridgeUrl": bridgeURL.absoluteString
        ]
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
