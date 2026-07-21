import Foundation
import UserNotifications

enum PhoneDexNotificationAuthorization: Equatable {
    case notDetermined
    case authorized
    case provisional
    case denied
    case restricted
    case unknown

    init(_ status: UNAuthorizationStatus) {
        switch status {
        case .notDetermined: self = .notDetermined
        case .authorized: self = .authorized
        case .provisional: self = .provisional
        case .denied: self = .denied
        case .ephemeral: self = .authorized
        @unknown default: self = .unknown
        }
    }

    var title: String {
        switch self {
        case .notDetermined: return "Notifications not set up"
        case .authorized: return "Notifications are enabled"
        case .provisional: return "Notifications are quietly enabled"
        case .denied: return "Notifications are disabled"
        case .restricted: return "Notifications are restricted"
        case .unknown: return "Notification status unavailable"
        }
    }

    var explanation: String {
        switch self {
        case .notDetermined:
            return "Allow alerts when a local hub reports a task update."
        case .authorized, .provisional:
            return "PhoneDex can alert you about local task updates."
        case .denied:
            return "Open iPhone Settings to allow alerts. PhoneDex still refreshes when you open it."
        case .restricted:
            return "This iPhone currently prevents notification changes. PhoneDex still refreshes when you open it."
        case .unknown:
            return "PhoneDex could not determine notification permission."
        }
    }

    var isEnabled: Bool { self == .authorized || self == .provisional }
    var canOpenSettings: Bool { self == .denied || self == .restricted }
}

enum PhoneDexNotificationScheduler {
    static let categoryIdentifier = "PHONEDEX_TASK"
    private static let maxPreviewBodyLength = 500

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

    static func authorizationStatus() async -> PhoneDexNotificationAuthorization {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        return PhoneDexNotificationAuthorization(settings.authorizationStatus)
    }

    static func schedulePreviewNotification() async throws {
        registerCategories()
        let identifier = "phonedex-preview"
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [identifier])
        center.removeDeliveredNotifications(withIdentifiers: [identifier])

        let content = UNMutableNotificationContent()
        content.title = PhoneDexNotificationCopy.previewTitle
        content.subtitle = PhoneDexNotificationCopy.previewSubtitle
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

    static func scheduleTaskNotification(
        _ task: PhoneDexTask,
        bridgeURL: URL,
        privacy: PhoneDexNotificationPrivacy = .safeSummary
    ) async throws {
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

        let presentation = notificationPresentation(for: task, privacy: privacy)
        let content = UNMutableNotificationContent()
        content.title = presentation.title
        content.subtitle = presentation.subtitle
        content.body = presentation.body
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

    static func notificationPresentation(
        for task: PhoneDexTask,
        privacy: PhoneDexNotificationPrivacy
    ) -> PhoneDexNotificationPresentation {
        let machine = task.machineName.map { "PhoneDex • \($0)" } ?? "PhoneDex"
        switch privacy {
        case .safeSummary:
            return PhoneDexNotificationPresentation(
                title: PhoneDexNotificationCopy.safeSummaryTitle,
                subtitle: machine,
                body: PhoneDexNotificationCopy.safeSummaryBody
            )
        case .fullPreview:
            return PhoneDexNotificationPresentation(
                title: boundedNotificationText(task.title, limit: 120),
                subtitle: machine,
                body: boundedNotificationText(task.text, limit: maxPreviewBodyLength)
            )
        }
    }

    private static func boundedNotificationText(_ value: String, limit: Int) -> String {
        let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.count > limit else { return normalized }
        return String(normalized.prefix(limit - 1)) + "…"
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
            title: PhoneDexNotificationCopy.okayWhatsNext,
            options: []
        )
        let proceed = UNNotificationAction(
            identifier: "PHONEDEX_LETS_DO_THAT",
            title: PhoneDexNotificationCopy.letsDoThat,
            options: []
        )
        let custom = UNTextInputNotificationAction(
            identifier: "PHONEDEX_CUSTOM_REPLY",
            title: PhoneDexNotificationCopy.customReply,
            options: [],
            textInputButtonTitle: PhoneDexNotificationCopy.sendReply,
            textInputPlaceholder: PhoneDexNotificationCopy.replyPlaceholder
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

enum PhoneDexNotificationPrivacy: String, CaseIterable, Identifiable {
    case safeSummary
    case fullPreview

    var id: String { rawValue }

    var title: String {
        switch self {
        case .safeSummary:
            return String(localized: "notification.privacy.safeSummary", defaultValue: "Safe Summary", comment: "Privacy-preserving notification setting.")
        case .fullPreview:
            return String(localized: "notification.privacy.fullPreview", defaultValue: "Full Preview", comment: "Opt-in notification setting that shows task text.")
        }
    }

    var explanation: String {
        switch self {
        case .safeSummary:
            return String(localized: "notification.privacy.safeSummary.explanation", defaultValue: "Hides task text, prompts, paths, and diffs from the lock screen.", comment: "Explanation for privacy-preserving notification delivery.")
        case .fullPreview:
            return String(localized: "notification.privacy.fullPreview.explanation", defaultValue: "Shows a concise task result on the lock screen and in Notification Center.", comment: "Explanation for opt-in notification previews.")
        }
    }
}

struct PhoneDexNotificationPresentation: Equatable {
    let title: String
    let subtitle: String
    let body: String
}

enum PhoneDexNotificationCopy {
    static let safeSummaryTitle = String(localized: "notification.safeSummary.title", defaultValue: "PhoneDex task update", comment: "Privacy-preserving notification title.")
    static let safeSummaryBody = String(localized: "notification.safeSummary.body", defaultValue: "Open PhoneDex to review the latest task.", comment: "Privacy-preserving notification body.")
    static let previewTitle = String(localized: "notification.preview.title", defaultValue: "Codex done: PR update", comment: "Title for the local notification preview.")
    static let previewSubtitle = String(localized: "notification.preview.subtitle", defaultValue: "PhoneDex • MacBook Air", comment: "Subtitle for the local notification preview.")
    static let okayWhatsNext = String(localized: "notification.action.okayWhatsNext", defaultValue: "Okay, what's next", comment: "Quick reply action asking Codex for the next step.")
    static let letsDoThat = String(localized: "notification.action.letsDoThat", defaultValue: "Let's do that", comment: "Quick reply action accepting a recommended next step.")
    static let customReply = String(localized: "notification.action.customReply", defaultValue: "Custom reply", comment: "Notification action that opens a typed or dictated reply.")
    static let sendReply = String(localized: "notification.action.sendReply", defaultValue: "Send", comment: "Button title that submits a custom notification reply.")
    static let replyPlaceholder = String(localized: "notification.action.replyPlaceholder", defaultValue: "Dictate or type your reply", comment: "Placeholder for a custom notification reply.")
}

enum PhoneDexNotificationError: LocalizedError, Equatable {
    case credentialBearingBridgeURL

    var errorDescription: String? {
        switch self {
        case .credentialBearingBridgeURL:
            return String(localized: "notification.error.credentialBearingBridgeURL", defaultValue: "The bridge URL must not contain credentials or query parameters.", comment: "Error shown when a notification is asked to use an unsafe bridge URL.")
        }
    }
}
